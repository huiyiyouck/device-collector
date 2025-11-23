// 核心功能：获取用户位置 -> 获取地址 -> 显示地址 -> 保存到数据库

// 检测是否为微信浏览器
function isWeChatBrowser() {
  var ua = navigator.userAgent || ''
  return /MicroMessenger/i.test(ua)
}

// 查询定位权限（微信浏览器不支持permissions API，直接返回prompt状态）
function queryPermission() {
  // 微信浏览器不支持 navigator.permissions API，直接返回 prompt 状态
  if (isWeChatBrowser()) {
    return Promise.resolve({ state: 'prompt' })
  }
  if (!navigator.permissions || !navigator.permissions.query) {
    return Promise.resolve({ state: 'prompt' })
  }
  return navigator.permissions.query({ name: 'geolocation' }).catch(function() { 
    return { state: 'prompt' } 
  })
}

// 获取定位（针对微信浏览器优化）
function getLocation() {
  return new Promise(function(resolve, reject) {
    if (!navigator.geolocation) {
      return reject(new Error('geolocation_unavailable'))
    }
    
    // 微信浏览器优先使用 getCurrentPosition（HTML5 Geolocation API标准方法）
    // 注意：微信浏览器基于WebView，需要用户交互（点击按钮）才能触发定位
    if (isWeChatBrowser()) {
      console.log('微信浏览器：使用 HTML5 Geolocation API (getCurrentPosition) 获取定位')
      // 检查是否由用户交互触发
      var lastInteraction = window.lastUserInteractionTime || 0;
      var now = Date.now();
      if (now - lastInteraction > 5000) { // 5秒内的交互才视为有效
        console.warn('微信浏览器：定位请求未在用户交互时间窗口内');
        var interactionErr = new Error('请点击"重新采集"按钮开始定位（微信浏览器需要用户交互）');
        interactionErr.code = 999; // 自定义错误代码
        interactionErr.hint = '微信浏览器限制：必须在用户点击按钮后的短时间内请求定位权限';
        return reject(interactionErr);
      }
      
      // 创建重试计数器
      var retryCount = 0;
      var maxRetries = 2; // 增加重试次数，提高成功率
      
      function attemptLocation() {
        navigator.geolocation.getCurrentPosition(
          function(pos) {
            console.log('微信浏览器：HTML5 Geolocation API 定位成功', pos.coords.latitude, pos.coords.longitude)
            resolve({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracy: pos.coords.accuracy || 9999,
              timestamp: pos.timestamp
            })
          },
          function(err) {
            console.error('微信浏览器：HTML5 Geolocation API 定位失败', err.code, err.message)
            
            // 如果是超时错误且未达到最大重试次数，则重试
            if (err.code === 3 && retryCount < maxRetries) {
              retryCount++;
              console.log(`微信浏览器：定位超时，正在进行第 ${retryCount} 次重试`);
              // 使用setTimeout确保在同一个事件循环中不会立即重试
              setTimeout(attemptLocation, 100);
              return;
            }
            
            // 如果是权限错误，提供更详细的错误信息
            if (err.code === 1) {
              var detailedErr = new Error('定位权限被拒绝（微信浏览器）')
              detailedErr.code = 1
              detailedErr.originalMessage = err.message
              detailedErr.hint = '请在微信设置中开启位置权限，或点击"重新采集"按钮重试';
              reject(detailedErr)
            } else if (err.code === 2) {
              var networkErr = new Error('定位服务不可用（请检查GPS和网络）')
              networkErr.code = 2
              reject(networkErr)
            } else if (err.code === 3) {
              var timeoutErr = new Error('定位超时（请检查网络连接，确保GPS已开启）')
              timeoutErr.code = 3
              reject(timeoutErr)
            } else {
              reject(err)
            }
          },
          {
            // HTML5 Geolocation API 标准参数
            enableHighAccuracy: true,  // 尝试获取高精度位置
            maximumAge: 60000,         // 允许使用60秒内的缓存位置（微信浏览器更宽松，减少请求）
            timeout: 30000             // 增加到30秒超时（微信浏览器可能需要更长时间）
          }
        );
      }
      
      // 开始尝试定位
      attemptLocation();
      return;
    }
    
    // 其他浏览器使用 watchPosition（更精确）
    var bestPosition = null
    var watchId = null
    var minAccuracy = 50 // 精度阈值（米）
    
    function cleanup() {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId)
        watchId = null
      }
    }
    
    function onPositionUpdate(pos) {
      var accuracy = pos.coords.accuracy || 9999
      if (accuracy <= minAccuracy) {
        cleanup()
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: accuracy,
          timestamp: pos.timestamp
        })
        return
      }
      if (!bestPosition || accuracy < bestPosition.accuracy) {
        bestPosition = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: accuracy,
          timestamp: pos.timestamp
        }
      }
    }
    
    function onError(err) {
      if (bestPosition) {
        cleanup()
        resolve(bestPosition)
        return
      }
      cleanup()
      reject(err)
    }
    
    watchId = navigator.geolocation.watchPosition(
      onPositionUpdate,
      onError,
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30000 // 30秒超时
      }
    )
    
    // 30秒后如果还没获取到精确位置，使用最佳位置
    setTimeout(function() {
      if (bestPosition) {
        cleanup()
        resolve(bestPosition)
      }
    }, 30000)
  })
}

// WGS84转GCJ02坐标转换
var pi = 3.1415926535897932384626
var a = 6378245.0
var ee = 0.00669342162296594323

function outOfChina(lat, lon) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x, y) {
  var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * pi) + 40.0 * Math.sin(y / 3.0 * pi)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * pi) + 320.0 * Math.sin(y * pi / 30.0)) * 2.0 / 3.0
  return ret
}

function transformLon(x, y) {
  var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * pi) + 40.0 * Math.sin(x / 3.0 * pi)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * pi) + 300.0 * Math.sin(x / 30.0 * pi)) * 2.0 / 3.0
  return ret
}

function wgs84ToGcj02(lat, lon) {
  if (outOfChina(lat, lon)) return { lat: lat, lon: lon, applicable: false }
  var dLat = transformLat(lon - 105.0, lat - 35.0)
  var dLon = transformLon(lon - 105.0, lat - 35.0)
  var radLat = lat / 180.0 * pi
  var magic = Math.sin(radLat)
  magic = 1 - ee * magic * magic
  var sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * pi)
  dLon = (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * pi)
  var mgLat = lat + dLat
  var mgLon = lon + dLon
  return { lat: mgLat, lon: mgLon, applicable: true }
}

// 显示位置信息
function displayLocationInfo(loc, gcj02) {
  var locationCard = document.getElementById('locationCard')
  var wgs84Coords = document.getElementById('wgs84Coords')
  var gcj02Coords = document.getElementById('gcj02Coords')
  var accuracyInfo = document.getElementById('accuracyInfo')
  
  if (!locationCard) return
  
  locationCard.style.display = 'block'
  
  if (wgs84Coords) {
    wgs84Coords.textContent = loc.lat.toFixed(6) + ', ' + loc.lon.toFixed(6)
  }
  if (gcj02Coords) {
    if (gcj02.applicable) {
      gcj02Coords.textContent = gcj02.lat.toFixed(6) + ', ' + gcj02.lon.toFixed(6)
    } else {
      gcj02Coords.textContent = '不适用（不在中国境内）'
    }
  }
  if (accuracyInfo) {
    var accuracy = loc.accuracy || 0
    var accuracyText = accuracy.toFixed(0) + ' 米'
    if (accuracy <= 20) {
      accuracyText += '（精确）'
    } else if (accuracy <= 100) {
      accuracyText += '（较精确）'
    } else {
      accuracyText += '（大致范围）'
    }
    accuracyInfo.textContent = accuracyText
  }
}

// 显示地址信息
function displayAddressInfo(addressInfo) {
  var addressEl = document.getElementById('addressInfo')
  if (!addressEl || !addressInfo) return
  
  var html = '<div class="address-line"><strong>📍 完整地址：</strong><span class="address-main">' + (addressInfo.address || '未知') + '</span></div>'
  
  if (addressInfo.country) {
    html += '<div class="address-line"><span class="address-label">国家：</span>' + addressInfo.country + '</div>'
  }
  if (addressInfo.province) {
    html += '<div class="address-line"><span class="address-label">省/州：</span>' + addressInfo.province + '</div>'
  }
  if (addressInfo.city) {
    html += '<div class="address-line"><span class="address-label">城市：</span>' + addressInfo.city + '</div>'
  }
  if (addressInfo.district) {
    html += '<div class="address-line"><span class="address-label">区/县：</span>' + addressInfo.district + '</div>'
  }
  if (addressInfo.street) {
    html += '<div class="address-line"><span class="address-label">街道：</span>' + addressInfo.street + '</div>'
  }
  
  addressEl.innerHTML = html
}

// 显示保存状态
function showSaveStatus(type, message) {
  var saveStatusEl = document.getElementById('saveStatus')
  var saveStatusMsgEl = document.getElementById('saveStatusMsg')
  
  if (!saveStatusEl || !saveStatusMsgEl) return
  
  saveStatusEl.className = 'save-status ' + type
  saveStatusMsgEl.textContent = message
  saveStatusEl.style.display = 'flex'
  
  var iconEl = saveStatusEl.querySelector('.save-status-icon')
  if (iconEl) {
    if (type === 'saving') {
      iconEl.textContent = '⏳'
    } else if (type === 'success') {
      iconEl.textContent = '✓'
    } else if (type === 'error') {
      iconEl.textContent = '✗'
    }
  }
}

function hideSaveStatus() {
  var saveStatusEl = document.getElementById('saveStatus')
  if (saveStatusEl) {
    saveStatusEl.style.display = 'none'
  }
}

// 获取设备信息
function getDeviceInfo() {
  var ua = navigator.userAgent
  var os = '未知'
  var model = '未知'
  if (/Android/i.test(ua)) os = 'Android'
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS'
  var m = ua.match(/(iPhone|iPad|iPod|SM-|MI|Redmi|HUAWEI|HONOR|Pixel|OnePlus)[^;\)]*/i)
  if (m) model = m[0]
  var osVersion = '未知'
  var am = ua.match(/Android\s([\d\.]+)/i)
  var im = ua.match(/OS\s([\d_]+)/i)
  if (am) osVersion = am[1]
  else if (im) osVersion = im[1].replace(/_/g, '.')
  
  return {
    ua: ua,
    os: os,
    model: model,
    osVersion: osVersion,
    screen: window.screen.width + 'x' + window.screen.height,
    network: navigator.connection ? (navigator.connection.effectiveType || '未知') : '未知'
  }
}

// 自动触发用户交互的函数（微信浏览器专用）
function triggerAutoInteraction() {
  if (!isWeChatBrowser()) return;
  
  // 创建一个全屏覆盖的交互层
  var interactionOverlay = document.createElement('div');
  interactionOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.8);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    z-index: 9999;
    color: white;
    font-size: 16px;
    text-align: center;
    padding: 20px;
  `;
  
  interactionOverlay.innerHTML = `
    <h2 style="color: #07C160; margin-bottom: 20px;">📍 获取您的位置信息</h2>
    <p style="margin-bottom: 30px;">为了提供更好的服务，请允许我们获取您的位置信息</p>
    <button id="autoLocationBtn" style="
      background-color: #07C160;
      color: white;
      border: none;
      padding: 12px 30px;
      font-size: 18px;
      border-radius: 25px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(7, 193, 96, 0.3);
    ">允许获取位置</button>
    <p style="margin-top: 20px; font-size: 14px; opacity: 0.8;">点击后将自动开始定位</p>
  `;
  
  document.body.appendChild(interactionOverlay);
  
  // 添加点击事件
  document.getElementById('autoLocationBtn').addEventListener('click', function() {
    // 记录用户交互时间
    window.lastUserInteractionTime = Date.now();
    // 移除覆盖层
    document.body.removeChild(interactionOverlay);
    // 开始定位
    collect();
  });
}

// 核心采集函数
function collect() {
  var statusEl = document.getElementById('status')
  var resultEl = document.getElementById('result')
  var hintEl = document.getElementById('permissionHint')
  var btn = document.getElementById('refreshBtn')
  
  if (!statusEl) return
  
  // 重置状态
  statusEl.className = 'status'
  statusEl.textContent = '准备采集'
  if (hintEl) hintEl.style.display = 'none'
  hideSaveStatus()
  if (btn) btn.disabled = true
  
  // 获取定位
  if (isWeChatBrowser()) {
    statusEl.textContent = '正在获取定位（微信浏览器，请稍候）...'
  } else {
    statusEl.textContent = '正在获取定位...'
  }
  
  return queryPermission().then(function(p) {
    if (isWeChatBrowser()) {
      statusEl.textContent = '正在获取定位（微信浏览器，可能需要几秒钟）...'
    } else {
      statusEl.textContent = '正在获取定位（可能需要几秒钟）...'
    }
    return getLocation().then(function(loc) {
      // 转换坐标
      var g = wgs84ToGcj02(loc.lat, loc.lon)
      
      // 显示位置信息
      displayLocationInfo(
        { lat: loc.lat, lon: loc.lon, accuracy: loc.accuracy },
        { lat: g.lat, lon: g.lon, applicable: g.applicable }
      )
      
      // 获取设备信息
      var device = getDeviceInfo()
      var data = {
        timestamp: Date.now(),
        location: {
          wgs84: { lat: loc.lat, lon: loc.lon, accuracy: loc.accuracy },
          gcj02: { lat: g.lat, lon: g.lon, applicable: g.applicable }
        },
        device: {
          model: device.model,
          osVersion: device.osVersion,
          screen: device.screen,
          network: device.network
        },
        browser: { ua: device.ua }
      }
      
      // 获取地址（同步等待）
      statusEl.textContent = '正在获取地址信息...'
      showSaveStatus('saving', '正在获取地址信息...')
      
      var url = '/api/address?lat=' + encodeURIComponent(g.lat) + '&lon=' + encodeURIComponent(g.lon) + '&coordType=gcj02&includeBaidu=true'
      
      return fetch(url)
        .then(function(res) { return res.json() })
        .then(function(addressData) {
          // 显示地址
          if (addressData && addressData.ok && addressData.address) {
            displayAddressInfo(addressData.address)
            data.address = addressData.address
            // 同时保存百度和腾讯地址信息
            if (addressData.baidu) {
              data.baidu_address = addressData.baidu;
            }
            if (addressData.tencent) {
              data.tencent_address = addressData.tencent;
            }
            statusEl.textContent = '地址获取成功'
          } else {
            statusEl.textContent = '地址获取失败'
          }
          
          // 保存到数据库
          statusEl.textContent = '正在保存数据...'
          showSaveStatus('saving', '正在保存数据到数据库...')
          
          return fetch('/api/device-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          }).then(function(res) { return res.json() })
            .then(function(resp) {
              if (resp && resp.ok) {
                statusEl.textContent = '采集完成！'
                showSaveStatus('success', '✓ 数据已成功保存到数据库')
                resultEl.textContent = JSON.stringify(data, null, 2)
              } else {
                statusEl.textContent = '保存失败'
                showSaveStatus('error', '✗ 数据保存失败，请重试')
              }
              if (btn) btn.disabled = false
            })
            .catch(function(err) {
              statusEl.textContent = '保存失败: ' + err.message
              showSaveStatus('error', '✗ 数据保存失败')
              if (btn) btn.disabled = false
            })
        })
        .catch(function(err) {
          statusEl.textContent = '地址获取失败: ' + err.message
          showSaveStatus('error', '✗ 地址获取失败')
          if (btn) btn.disabled = false
        })
    })
    .catch(function(err) {
      console.error('定位错误详情:', err)
      var errorMsg = '定位失败'
      var showHint = false
      
      if (err && err.code === 999) {
        // 自定义错误：未在用户交互时间窗口内
        errorMsg = '请点击"重新采集"按钮开始定位';
        showHint = true;
        if (hintEl) {
          hintEl.innerHTML = '<strong>🔔 需要用户交互：</strong><br>' +
            '微信浏览器要求必须在用户点击按钮后的短时间内请求定位权限。<br><br>' +
            '<strong>请按以下步骤操作：</strong><br>' +
            '1. 请确保手机GPS已开启<br>' +
            '2. 点击页面中的"重新采集"按钮<br>' +
            '3. 在弹出的权限请求中选择"允许"<br>' +
            '4. 等待定位完成';
          hintEl.style.display = 'block';
        }
      } else if (err && err.code === 1) {
        // 权限被拒绝
        if (isWeChatBrowser()) {
          // 微信浏览器特殊提示
          errorMsg = '定位权限被拒绝（微信浏览器）'
          showHint = true
          if (hintEl) {
            hintEl.innerHTML = '<strong>🔧 微信浏览器定位权限设置步骤：</strong><br><br>' +
              '<strong>方法一：在微信中设置</strong><br>' +
              '1. 点击微信右上角"..."（三个点）<br>' +
              '2. 选择"设置"<br>' +
              '3. 选择"通用"<br>' +
              '4. 选择"功能"<br>' +
              '5. 找到"位置信息"并开启<br><br>' +
              '<strong>方法二：在手机系统设置中</strong><br>' +
              '1. 打开手机"设置"<br>' +
              '2. 找到"应用"或"应用管理"<br>' +
              '3. 找到"微信"<br>' +
              '4. 选择"权限"或"应用权限"<br>' +
              '5. 找到"位置信息"或"位置权限"<br>' +
              '6. 选择"使用应用期间"或"始终"<br><br>' +
              '<strong>⚠️ 重要提示：</strong><br>' +
              '• 设置完成后，请返回此页面<br>' +
              '• 点击"重新采集"按钮重新获取定位<br>' +
              '• 首次使用时，微信会弹出定位权限请求，请选择"允许"'
            hintEl.style.display = 'block'
          }
        } else {
          errorMsg = '定位权限被拒绝'
          showHint = true
          if (hintEl) hintEl.style.display = 'block'
        }
      } else if (err && err.code === 2) {
        errorMsg = '定位服务不可用（请检查GPS是否开启）'
        showHint = true;
        if (hintEl && isWeChatBrowser()) {
          hintEl.innerHTML += '<br><strong>🚩 提示：</strong>请确保您的手机GPS服务已开启，并在信号良好的位置重试。';
          hintEl.style.display = 'block';
        }
      } else if (err && err.code === 3) {
        errorMsg = '定位超时（请检查网络连接和GPS信号）'
        showHint = true;
        if (hintEl && isWeChatBrowser()) {
          hintEl.innerHTML += '<br><strong>⏱️ 提示：</strong>定位超时，请确保网络连接良好，并在户外开阔地带重试。';
          hintEl.style.display = 'block';
        }
      } else if (err && err.message) {
        errorMsg = '定位失败: ' + err.message
        // 如果是微信浏览器，添加额外提示
        if (isWeChatBrowser()) {
          errorMsg += '（微信浏览器需要用户点击交互，请重试）'
          showHint = true;
          if (hintEl) hintEl.style.display = 'block';
        }
      }
      
      statusEl.textContent = errorMsg
      statusEl.className = 'status error'
      showSaveStatus('error', '✗ ' + errorMsg)
      if (btn) btn.disabled = false
      
      // 即使定位失败，也尝试保存设备信息
      var device = getDeviceInfo()
      var data = {
        timestamp: Date.now(),
        location: {
          wgs84: { lat: null, lon: null, accuracy: null },
          gcj02: { lat: null, lon: null, applicable: false }
        },
        device: {
          model: device.model,
          osVersion: device.osVersion,
          screen: device.screen,
          network: device.network
        },
        browser: { ua: device.ua },
        error: errorMsg
      }
      
      // 尝试保存（即使没有位置信息）
      fetch('/api/device-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).catch(function() {
        // 静默处理保存失败
      })
    })
  })
}

// iOS兼容点击
function addIOSCompatibleClick(element, handler) {
  var isTouch = false
  element.addEventListener('touchstart', function() {
    isTouch = true
    // 记录用户交互时间，用于微信浏览器定位检查
    window.lastUserInteractionTime = Date.now();
  })
  element.addEventListener('touchend', function(e) {
    if (isTouch) {
      e.preventDefault()
      // 再次更新交互时间，确保在touchend时也是最新的
      window.lastUserInteractionTime = Date.now();
      handler()
    }
    isTouch = false
  })
  element.addEventListener('touchmove', function(e) {
    isTouch = false
  })
  element.addEventListener('click', function(e) {
    if (!isTouch) {
      // 记录鼠标点击交互
      window.lastUserInteractionTime = Date.now();
      handler()
    }
  })
}

// 页面加载完成后
document.addEventListener('DOMContentLoaded', function() {
  try {
    var btn = document.getElementById('refreshBtn')
    var statusEl = document.getElementById('status')
    
    if (btn) {
      addIOSCompatibleClick(btn, function() { 
        collect() 
      })
    }
    
    // 微信浏览器特殊处理：需要用户交互才能获取定位
    if (isWeChatBrowser()) {
      // 微信浏览器中，显示自动交互引导层
      triggerAutoInteraction();
      
      // 同时保留原有提示，确保用户可以手动触发
      if (statusEl) {
        statusEl.textContent = '请点击"允许获取位置"按钮开始定位';
        statusEl.className = 'status';
      }
    } else {
      // 其他浏览器自动开始采集
      collect()
    }
  } catch (e) {
    console.error('页面初始化失败:', e)
    var statusEl = document.getElementById('status')
    if (statusEl) {
      statusEl.textContent = '页面加载失败，请刷新重试'
      statusEl.className = 'status error'
    }
  }
})

// 全局错误处理（捕获未处理的错误）
window.addEventListener('error', function(e) {
  console.error('页面错误:', e.message, e.filename, e.lineno)
  var statusEl = document.getElementById('status')
  if (statusEl && statusEl.textContent === '准备采集') {
    statusEl.textContent = '页面加载出错，请刷新重试'
    statusEl.className = 'status error'
  }
})