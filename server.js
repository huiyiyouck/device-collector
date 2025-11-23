import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import url from 'url'
import { createHash } from 'crypto'
import sql from './db.js'

const PORT = process.env.PORT || 3000

// 日志级别配置：silent(静默) | error(仅错误) | warn(警告+错误) | info(信息+警告+错误) | debug(全部)
const LOG_LEVEL = (process.env.LOG_LEVEL || 'error').toLowerCase()

// 日志工具函数
const logger = {
  debug: (...args) => {
    if (['debug'].includes(LOG_LEVEL)) {
      console.log('[DEBUG]', ...args)
    }
  },
  info: (...args) => {
    if (['debug', 'info'].includes(LOG_LEVEL)) {
      console.log('[INFO]', ...args)
    }
  },
  warn: (...args) => {
    if (['debug', 'info', 'warn'].includes(LOG_LEVEL)) {
      console.warn('[WARN]', ...args)
    }
  },
  error: (...args) => {
    if (['debug', 'info', 'warn', 'error'].includes(LOG_LEVEL)) {
      console.error('[ERROR]', ...args)
    }
  }
}

// 微信配置（从环境变量读取，或直接配置）
const WX_APPID = process.env.WX_APPID || ''
const WX_APPSECRET = process.env.WX_APPSECRET || ''
const WX_REDIRECT_URI = process.env.WX_REDIRECT_URI || '' // 例如: https://yourdomain.com/

// 高德地图API配置
const AMAP_KEY = process.env.AMAP_KEY || '78e92a262772475111887c98467d0407'

// 百度地图API配置
const BAIDU_KEY = process.env.BAIDU_KEY || 'x2VXW6mpP6O5B1uOETXuKo3A54N9bz0C'

// 腾讯地图API配置
const TENCENT_KEY = process.env.TENCENT_KEY || 'CKDBZ-WPBKB-MYJU3-NVAVA-FKPLH-7IBKH'

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, function(err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    } else {
      // 添加微信和移动端需要的响应头
      const headers = {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache'
      }
      res.writeHead(200, headers)
      res.end(data)
    }
  })
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for']
  if (xf) return String(xf).split(',')[0].trim()
  return req.socket.remoteAddress
}

// 处理微信JS-SDK配置请求
async function handleWxConfigRequest(req, res) {
  try {
    // 添加 CORS 头
    const addCorsHeaders = () => {
      if (!res.headersSent) {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      }
    }
    
    // 获取请求的完整URL（不包含#及其后面部分）
    // 优先使用 referer，如果没有则从请求头构建
    let url = req.headers.referer || ''
    
    if (!url) {
      // 从请求头构建完整 URL
      const host = req.headers.host || 'localhost:3000'
      const protocol = req.headers['x-forwarded-proto'] || 'http'
      const parsedUrl = url.parse(req.url)
      const pathname = parsedUrl.pathname || '/'
      url = `${protocol}://${host}${pathname}`
    }
    
    // 去掉 # 及其后面的部分
    url = url.split('#')[0]
    
    // 如果 URL 为空或无效，使用默认值
    if (!url || !url.startsWith('http')) {
      const host = req.headers.host || '192.168.31.213:3000'
      url = `http://${host}/`
    }
    
    const config = await getWechatJsConfig(url)
    
    if (config) {
      addCorsHeaders()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(config))
    } else {
      // 如果配置失败，返回基本配置，让前端尝试使用普通定位
      addCorsHeaders()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ appId: WX_APPID }))
    }
  } catch (err) {
    logger.debug('处理微信配置请求出错:', err)
    if (!res.headersSent) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ appId: WX_APPID })) // 返回 appId，让前端继续执行
    }
  }
}

// 保存数据到数据库
async function saveToDatabase(record) {
  try {
    const wx = record.wechat || {}
    const baiduAddr = record.baidu_address || {} // 百度地址对象
    const tencentAddr = record.tencent_address || {} // 腾讯地址对象
    
    // record.address 已经是字符串，record.country, record.province 等已经是提取好的值
    await sql`
      INSERT INTO device_data (
        timestamp, ip,
        wgs84_lat, wgs84_lon, wgs84_accuracy,
        gcj02_lat, gcj02_lon, gcj02_applicable,
        address, country, province, city, district, street, adcode, citycode,
        baidu_address, baidu_country, baidu_province, baidu_city, baidu_district, baidu_street, baidu_adcode, baidu_citycode,
        tencent_address, tencent_country, tencent_province, tencent_city, tencent_district, tencent_street, tencent_street_number, tencent_adcode, tencent_town, tencent_landmark_l1, tencent_landmark_l2,
        device_model, os_version, screen_w, screen_h, dpr,
        network_type, effective_type, ua,
        wx_openid, wx_nickname, wx_headimgurl, wx_sex, wx_province, wx_city, wx_country
      ) VALUES (
        ${record.timestamp}, ${record.ip},
        ${record.wgs84_lat}, ${record.wgs84_lon}, ${record.wgs84_accuracy},
        ${record.gcj02_lat}, ${record.gcj02_lon}, ${record.gcj02_applicable},
        ${record.address}, ${record.country}, ${record.province}, ${record.city},
        ${record.district}, ${record.street}, ${record.adcode}, ${record.citycode},
        ${baiduAddr.address || null}, ${baiduAddr.country || null}, ${baiduAddr.province || null}, ${baiduAddr.city || null},
        ${baiduAddr.district || null}, ${baiduAddr.street || null}, ${baiduAddr.adcode || null}, ${baiduAddr.citycode || null},
        ${tencentAddr.address || null}, ${tencentAddr.country || null}, ${tencentAddr.province || null}, ${tencentAddr.city || null},
        ${tencentAddr.district || null}, ${tencentAddr.street || null}, ${tencentAddr.street_number || null}, ${tencentAddr.adcode || null},
        ${tencentAddr.town || null}, ${tencentAddr.landmark_l1 || null}, ${tencentAddr.landmark_l2 || null},
        ${record.device_model}, ${record.os_version},
        ${record.screen_w}, ${record.screen_h}, ${record.dpr},
        ${record.network_type}, ${record.effective_type}, ${record.ua},
        ${wx.openid || null}, ${wx.nickname || null}, ${wx.headimgurl || null}, ${wx.sex || null},
        ${wx.province || null}, ${wx.city || null}, ${wx.country || null}
      )
    `
  } catch (err) {
    // 根据日志级别输出错误信息
    logger.error(`DB Error: ${err.code || 'unknown'} - ${err.message}`)
    if (LOG_LEVEL === 'debug') {
      if (err.detail) logger.debug(`  PostgreSQL详情: ${err.detail}`)
      if (err.hint) logger.debug(`  提示: ${err.hint}`)
      try {
        const errorInfo = {
          message: err.message,
          code: err.code,
          detail: err.detail,
          hint: err.hint,
          severity: err.severity
        }
        logger.debug(`  错误详情:`, JSON.stringify(errorInfo, null, 2))
      } catch (e) {
        // 忽略序列化错误
      }
    }
    throw err // 重新抛出错误，让调用者处理
  }
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

// HTTP请求工具函数（带超时）
function httpGet(urlStr, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = https.get(urlStr, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error('Invalid JSON response'))
        }
      })
    })
    
    req.on('error', reject)
    
    // 设置超时
    req.setTimeout(timeout, () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
  })
}

// 生成随机字符串
function generateNonceStr() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// 通过code获取微信access_token
async function getWxAccessToken(code) {
  if (!WX_APPID || !WX_APPSECRET) {
    throw new Error('微信配置未设置')
  }
  const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${WX_APPID}&secret=${WX_APPSECRET}&code=${code}&grant_type=authorization_code`
  return await httpGet(tokenUrl)
}

// 获取微信JS-SDK配置
async function getWechatJsConfig(url) {
  try {
    // 获取access_token
    const tokenResponse = await httpGet(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WX_APPID}&secret=${WX_APPSECRET}`);
    
    if (!tokenResponse.access_token) {
      throw new Error('获取access_token失败');
    }
    
    // 获取jsapi_ticket
    const ticketResponse = await httpGet(`https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${tokenResponse.access_token}&type=jsapi`);
    
    if (ticketResponse.errcode !== 0) {
      throw new Error('获取jsapi_ticket失败: ' + ticketResponse.errmsg);
    }
    
    // 生成签名
      const nonceStr = generateNonceStr();
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const jsapi_ticket = ticketResponse.ticket;
      
      // 使用crypto模块生成sha1签名
      const signatureStr = `jsapi_ticket=${jsapi_ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
      const signature = createHash('sha1').update(signatureStr).digest('hex');
      
      return {
        appId: WX_APPID,
        timestamp: timestamp,
        nonceStr: nonceStr,
        signature: signature,
        url: url
      };
  } catch (err) {
    logger.debug('获取微信JS-SDK配置失败:', err);
    return null;
  }
}

// 通过access_token获取微信用户信息
async function getWxUserInfo(accessToken, openid) {
  const userInfoUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${accessToken}&openid=${openid}&lang=zh_CN`
  return await httpGet(userInfoUrl)
}

// GCJ02坐标系转BD09坐标系（用于百度地图）
function gcj02ToBd09(gcjLat, gcjLon) {
  const x = gcjLon
  const y = gcjLat
  const z = Math.sqrt(x * x + y * y) + 0.00002 * Math.sin(y * Math.PI * 3000.0 / 180.0)
  const theta = Math.atan2(y, x) + 0.000003 * Math.cos(x * Math.PI * 3000.0 / 180.0)
  const bdLon = z * Math.cos(theta) + 0.0065
  const bdLat = z * Math.sin(theta) + 0.006
  return { lat: bdLat, lon: bdLon }
}

// 通过百度地图API获取地址信息（反向地理编码）
// 注意：百度地图使用BD09坐标系
async function getBaiduAddressFromCoords(lat, lon) {
  try {
    // 百度地图逆地理编码API
    // 注意：如果API Key配置了IP白名单，需要将服务器IP添加到白名单中
    const url = `https://api.map.baidu.com/reverse_geocoding/v3?ak=${BAIDU_KEY}&output=json&coordtype=bd09ll&location=${lat},${lon}&radius=100&extensions_poi=1`
    const data = await httpGet(url, 10000)
    
    // 检查API返回状态
    if (data && data.status === 0 && data.result) {
      const result = data.result
      const addressComponent = result.addressComponent || {}
      
      // 构建完整地址
      let fullAddress = result.formatted_address || result.sematic_description || ''
      
      // 如果有POI信息，添加到地址中
      if (result.pois && result.pois.length > 0) {
        const poi = result.pois[0]
        if (poi.name) {
          fullAddress = `${poi.name}${fullAddress ? '，' + fullAddress : ''}`
        }
      }
      
      return {
        address: fullAddress,
        country: addressComponent.country || '',
        province: addressComponent.province || '',
        city: addressComponent.city || addressComponent.province || '',
        district: addressComponent.district || '',
        street: addressComponent.street || '',
        adcode: addressComponent.adcode || '',
        citycode: addressComponent.citycode || '',
        // 百度地图特有字段
        town: addressComponent.town || '',
        town_code: addressComponent.town_code || '',
        direction: addressComponent.direction || '',
        distance: addressComponent.distance || ''
      }
    } else if (data && data.status) {
      // 静默处理所有错误，减少日志输出
      return null
    }
    return null
  } catch (e) {
    logger.debug('获取百度地图地址信息失败:', e.message)
    return null
  }
}

// 通过高德地图API获取地址信息（反向地理编码）
// 注意：高德地图使用GCJ02坐标系，传入的坐标应该是GCJ02格式
async function getAmapAddressFromCoords(lat, lon, useGcj02 = true) {
  try {
    // 高德地图逆地理编码API
    // 优化参数以提高精准度：
    // - radius: 减小搜索半径到100米，提高精准度
    // - extensions: 使用all获取详细信息
    // - roadlevel: 获取道路级别信息
    // - poitype: 获取POI类型信息
    const url = `https://restapi.amap.com/v3/geocode/regeo?key=${AMAP_KEY}&location=${lon},${lat}&output=json&radius=100&extensions=all&roadlevel=1&poitype=120000|150000|160000`
    const data = await httpGet(url, 5000)
    
    if (data && data.status === '1' && data.regeocode) {
      const regeocode = data.regeocode
      const addressComponent = regeocode.addressComponent || {}
      
      // 优先使用详细地址，如果没有则使用格式化地址
      let fullAddress = regeocode.formatted_address || ''
      
      // 如果有道路信息，添加到地址中
      if (regeocode.roads && regeocode.roads.length > 0) {
        const road = regeocode.roads[0]
        if (road.name) {
          fullAddress = `${road.name}${fullAddress ? '，' + fullAddress : ''}`
        }
      }
      
      // 如果有POI信息，添加到地址中
      if (regeocode.pois && regeocode.pois.length > 0) {
        const poi = regeocode.pois[0]
        if (poi.name) {
          fullAddress = `${poi.name}${fullAddress ? '，' + fullAddress : ''}`
        }
      }
      
      return {
        address: fullAddress,
        country: addressComponent.country || '',
        province: addressComponent.province || '',
        city: addressComponent.city || addressComponent.province || '',
        district: addressComponent.district || '',
        street: addressComponent.street || (regeocode.roads && regeocode.roads[0] ? regeocode.roads[0].name : ''),
        adcode: addressComponent.adcode || '',
        citycode: addressComponent.citycode || '',
        // 添加更详细的信息
        township: addressComponent.township || '',
        neighborhood: addressComponent.neighborhood || '',
        building: addressComponent.building || ''
      }
    }
    return null
  } catch (e) {
    logger.debug('获取百度地图地址信息失败:', e.message)
    return null
  }
}

// 同时获取高德和百度地图的地址信息
// gcj02Lat, gcj02Lon: GCJ02坐标（用于高德地图）
// wgs84Lat, wgs84Lon: WGS84坐标（用于转换，兼容iPhone）
async function getAllAddresses(gcj02Lat, gcj02Lon, wgs84Lat, wgs84Lon) {
  // 转换BD09坐标（用于百度地图）
  const bd09Coords = gcj02ToBd09(gcj02Lat, gcj02Lon)
  
  // 并行获取高德和百度地址（即使百度失败也不影响高德）
  // 高德地址是必需的，百度地址是可选的
  const [amapAddress, baiduAddress] = await Promise.all([
    // 高德地图使用GCJ02坐标（优先，必需）
    getAmapAddressFromCoords(gcj02Lat, gcj02Lon, true).catch((err) => {
      logger.warn(`获取高德地址失败:`, err.message)
      return null
    }),
    // 百度地图使用BD09坐标（可选，失败不影响，静默失败）
    getBaiduAddressFromCoords(bd09Coords.lat, bd09Coords.lon).catch(() => {
      // 静默失败，不记录日志
      return null
    })
  ])
  
  // 记录高德地址获取失败
  if (!amapAddress) {
    logger.warn('高德地址获取失败')
  }
  
  // 即使百度地址失败，只要有高德地址就返回成功
  return {
    amap: amapAddress,
    baidu: baiduAddress
  }
}

// 通过腾讯地图API获取地址信息（反向地理编码）
// 注意：腾讯地图使用GCJ02坐标系
async function getTencentAddressFromCoords(lat, lon) {
  try {
    // 腾讯地图逆地址解析API
    // 文档: https://lbs.qq.com/service/webService/webServiceGuide/address/Gcoder
    const url = `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lon}&key=${TENCENT_KEY}&get_poi=1&output=json`
    const data = await httpGet(url, 5000)
    
    if (data && data.status === 0 && data.result) {
      const result = data.result
      const addressComponent = result.address_component || {}
      
      // 优先使用推荐地址，如果没有则使用标准地址
      let fullAddress = result.recommend || result.address || ''
      
      // 如果有标准地址（基于POI的精确地址），优先使用
      if (result.formatted_addresses && result.formatted_addresses.standard_address) {
        fullAddress = result.formatted_addresses.standard_address
      }
      
      // 如果有POI信息，添加到地址中
      if (result.pois && result.pois.length > 0) {
        const poi = result.pois[0]
        if (poi.title) {
          fullAddress = `${poi.title}${fullAddress ? '，' + fullAddress : ''}`
        }
      }
      
      return {
        address: fullAddress,
        country: addressComponent.nation || '',
        province: addressComponent.province || '',
        city: addressComponent.city || addressComponent.province || '',
        district: addressComponent.district || '',
        street: addressComponent.street || '',
        street_number: addressComponent.street_number || '',
        adcode: addressComponent.adcode ? String(addressComponent.adcode) : '',
        citycode: '', // 腾讯地图没有citycode字段
        // 腾讯地图特有字段
        town: addressComponent.town ? addressComponent.town.title : '',
        landmark_l1: result.landmark_l1 ? result.landmark_l1.title : '',
        landmark_l2: result.landmark_l2 ? result.landmark_l2.title : ''
      }
    } else if (data && data.status) {
      // 静默处理所有错误，减少日志输出
      return null
    }
    return null
  } catch (e) {
    logger.debug('获取百度地图地址信息失败:', e.message)
    return null
  }
}

// 兼容旧接口：通过经纬度获取地址信息（默认使用高德）
async function getAddressFromCoords(lat, lon, useGcj02 = true) {
  return await getAmapAddressFromCoords(lat, lon, useGcj02)
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url)
  
  // 处理OPTIONS预检请求（CORS）
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    })
    return res.end()
  }
  
  // 为所有API响应添加CORS头（只在响应未发送时调用）
  const addCorsHeaders = () => {
    if (!res.headersSent) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    }
  }
  
  // 只记录API请求，不记录静态资源请求（减少IO）
  if (req.method !== 'GET' || (parsed.pathname && parsed.pathname.startsWith('/api'))) {
    // 仅记录API请求，减少日志IO
  }
  
  if (req.method === 'GET' && (parsed.pathname === '/' || parsed.pathname === '/index.html')) {
    return serveFile(res, path.join(process.cwd(), 'index.html'), 'text/html; charset=utf-8')
  }
  if (req.method === 'GET' && parsed.pathname === '/styles.css') {
    return serveFile(res, path.join(process.cwd(), 'styles.css'), 'text/css; charset=utf-8')
  }
  if (req.method === 'GET' && parsed.pathname === '/app.js') {
    return serveFile(res, path.join(process.cwd(), 'app.js'), 'application/javascript; charset=utf-8')
  }
  if (req.method === 'GET' && parsed.pathname === '/health') {
    addCorsHeaders()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true }))
  }
  
  // 微信授权回调 - 通过code获取用户信息
  if (req.method === 'GET' && parsed.pathname === '/api/wechat/auth') {
    const query = new URLSearchParams(parsed.query || '')
    const code = query.get('code')
    
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: false, code: 'no_code' }))
    }
    
    try {
      // 获取access_token
      const tokenData = await getWxAccessToken(code)
      if (tokenData.errcode) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok: false, code: 'wx_error', msg: tokenData.errmsg }))
      }
      
      // 获取用户信息
      const userInfo = await getWxUserInfo(tokenData.access_token, tokenData.openid)
      if (userInfo.errcode) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok: false, code: 'wx_error', msg: userInfo.errmsg }))
      }
      
      // 返回用户信息
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({
        ok: true,
        wechat: {
          openid: userInfo.openid,
          nickname: userInfo.nickname,
          headimgurl: userInfo.headimgurl,
          sex: userInfo.sex,
          province: userInfo.province,
          city: userInfo.city,
          country: userInfo.country
        }
      }))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: false, code: 'server_error', msg: e.message }))
    }
  }
  
  // 获取微信授权URL
  if (req.method === 'GET' && parsed.pathname === '/api/wechat/auth-url') {
    if (!WX_APPID || !WX_REDIRECT_URI) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: false, code: 'not_configured' }))
    }
    const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${WX_APPID}&redirect_uri=${encodeURIComponent(WX_REDIRECT_URI)}&response_type=code&scope=snsapi_userinfo&state=STATE#wechat_redirect`
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, authUrl: authUrl }))
  }
  
  // 微信JS-SDK配置API
  if (req.method === 'GET' && parsed.pathname === '/api/wx-config') {
    handleWxConfigRequest(req, res);
    return;
  }
  
  // 获取地址信息API（通过经纬度）- 返回高德地址，可选返回百度地址
  if (req.method === 'GET' && parsed.pathname === '/api/address') {
    const query = new URLSearchParams(parsed.query || '')
    const lat = parseFloat(query.get('lat'))
    const lon = parseFloat(query.get('lon'))
    const coordType = query.get('coordType') || 'gcj02' // gcj02 或 wgs84
    const includeBaidu = query.get('includeBaidu') === 'true' // 是否包含百度地址
    
    if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
      addCorsHeaders()
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: false, code: 'invalid_params', msg: '缺少经纬度参数' }))
    }
    
    try {
      // 获取高德地址（核心功能，必需）
      const amapAddress = await getAmapAddressFromCoords(lat, lon, coordType === 'gcj02')
      
      if (!amapAddress) {
        logger.warn(`高德地址获取失败 - 坐标: (${lat}, ${lon})`)
        addCorsHeaders()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok: false, code: 'address_not_found' }))
      }
      
      // 如果需要其他地图地址，异步获取（不阻塞响应）
      let baiduAddress = null
      let tencentAddress = null
      if (includeBaidu && coordType === 'gcj02') {
        // 并行获取百度地址和腾讯地址（静默获取，失败不记录日志）
        const [baiduResult, tencentResult] = await Promise.allSettled([
          // 获取百度地址
          (async () => {
            try {
              const bd09Coords = gcj02ToBd09(lat, lon)
              return await getBaiduAddressFromCoords(bd09Coords.lat, bd09Coords.lon)
            } catch (err) {
              // 静默失败，不记录日志
              return null
            }
          })(),
          // 获取腾讯地址
          (async () => {
            try {
              return await getTencentAddressFromCoords(lat, lon)
            } catch (err) {
              // 静默失败，不记录日志
              return null
            }
          })()
        ])
        
        baiduAddress = baiduResult.status === 'fulfilled' ? baiduResult.value : null
        tencentAddress = tencentResult.status === 'fulfilled' ? tencentResult.value : null
      }
      
      addCorsHeaders()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ 
        ok: true, 
        address: amapAddress,
        baidu: baiduAddress, // 如果获取失败则为 null
        tencent: tencentAddress // 如果获取失败则为 null
      }))
    } catch (e) {
      logger.error(`地址获取异常:`, e.message)
      if (!res.headersSent) {
        addCorsHeaders()
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, code: 'server_error', msg: e.message }))
      }
      return
    }
  }
  if (req.method === 'POST' && parsed.pathname === '/api/device-data') {
    try {
      const body = await parseJson(req)
      const ip = getClientIp(req)
      const ts = Number(body.timestamp) || Date.now()
      const wgs = body.location && body.location.wgs84 || {}
      const gcj = body.location && body.location.gcj02 || {}
      const dev = body.device || {}
      const scr = dev.screen || {}
      const net = dev.network || {}
      const ua = (body.browser && body.browser.ua) || ''
      const addr = body.address || {} // 前端已获取的高德地址对象
      
      // 异步获取百度地址和腾讯地址（不阻塞主流程，静默获取）
      let baiduAddr = null
      let tencentAddr = null
      if (gcj.lat && gcj.lon && gcj.applicable) {
        // 并行获取百度地址和腾讯地址（静默获取，失败不记录日志）
        const [baiduResult, tencentResult] = await Promise.allSettled([
          // 获取百度地址
          (async () => {
            try {
              const bd09Coords = gcj02ToBd09(gcj.lat, gcj.lon)
              return await getBaiduAddressFromCoords(bd09Coords.lat, bd09Coords.lon)
            } catch (err) {
              // 静默失败，不记录日志
              return null
            }
          })(),
          // 获取腾讯地址
          (async () => {
            try {
              return await getTencentAddressFromCoords(gcj.lat, gcj.lon)
            } catch (err) {
              // 静默失败，不记录日志
              return null
            }
          })()
        ])
        
        baiduAddr = baiduResult.status === 'fulfilled' ? baiduResult.value : null
        tencentAddr = tencentResult.status === 'fulfilled' ? tencentResult.value : null
      }
      
      // 构建记录对象（只包含数据库表中存在的字段）
      const record = {
        timestamp: ts,
        ip: ip,
        wgs84_lat: (wgs.lat !== undefined && wgs.lat !== null) ? wgs.lat : null,
        wgs84_lon: (wgs.lon !== undefined && wgs.lon !== null) ? wgs.lon : null,
        wgs84_accuracy: (wgs.accuracy !== undefined && wgs.accuracy !== null) ? wgs.accuracy : null,
        gcj02_lat: (gcj.lat !== undefined && gcj.lat !== null) ? gcj.lat : null,
        gcj02_lon: (gcj.lon !== undefined && gcj.lon !== null) ? gcj.lon : null,
        gcj02_applicable: (gcj.applicable !== undefined && gcj.applicable !== null) ? gcj.applicable : false,
        // 高德地址字段（从地址对象中提取）
        address: (addr && addr.address) ? addr.address : null,
        country: (addr && addr.country) ? addr.country : null,
        province: (addr && addr.province) ? addr.province : null,
        city: (addr && addr.city) ? addr.city : null,
        district: (addr && addr.district) ? addr.district : null,
        street: (addr && addr.street) ? addr.street : null,
        adcode: (addr && addr.adcode) ? addr.adcode : null,
        citycode: (addr && addr.citycode) ? addr.citycode : null,
        // 百度地址字段
        baidu_address: baiduAddr,
        // 腾讯地址字段
        tencent_address: tencentAddr,
        // 设备信息
        device_model: (dev.model !== undefined && dev.model !== null) ? dev.model : null,
        os_version: (dev.osVersion !== undefined && dev.osVersion !== null) ? dev.osVersion : null,
        screen_w: (scr.width !== undefined && scr.width !== null) ? scr.width : null,
        screen_h: (scr.height !== undefined && scr.height !== null) ? scr.height : null,
        dpr: (scr.dpr !== undefined && scr.dpr !== null) ? scr.dpr : null,
        network_type: (net.type !== undefined && net.type !== null) ? net.type : null,
        effective_type: (net.effectiveType !== undefined && net.effectiveType !== null) ? net.effectiveType : null,
        ua: ua || null,
        // 微信信息（当前不使用，设为null）
        wechat: null
      }
      
      // 保存到数据库（包含地址信息）
      try {
        await saveToDatabase(record)
        
        // 保存成功，返回响应（不记录成功日志，减少IO）
        if (!res.headersSent) {
          addCorsHeaders()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        }
        return // 确保不会继续执行
      } catch (err) {
        logger.error(`保存到数据库失败 - IP: ${ip}, 错误:`, err.message)
        if (LOG_LEVEL === 'debug') {
          logger.debug(`  错误详情:`, err)
        }
        if (!res.headersSent) {
          addCorsHeaders()
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ 
            ok: false, 
            code: 'save_failed', 
            msg: err.message || '数据库保存失败'
          }))
        }
        return
      }
    } catch (e) {
      logger.error(`处理请求异常:`, e.message)
      if (LOG_LEVEL === 'debug') {
        logger.debug(`  异常堆栈:`, e.stack)
      }
      if (!res.headersSent) {
        addCorsHeaders()
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, code: 'bad_request', msg: e.message }))
      }
      return
    }
  }
  
  // 404处理（确保响应未发送）
  if (!res.headersSent) {
    addCorsHeaders()
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, code: 'not_found' }))
  }
})

server.listen(PORT, () => {
  logger.info(`服务器已启动，监听端口 ${PORT}`)
  logger.info(`访问地址: http://localhost:${PORT}`)
  logger.info(`日志级别: ${LOG_LEVEL.toUpperCase()}`)
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`端口 ${PORT} 已被占用，请先停止其他服务`)
    process.exit(1)
  } else {
    logger.error('服务器启动失败:', err)
    process.exit(1)
  }
})