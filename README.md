# Device Collector

设备数据收集服务 - 用于收集设备信息、地理位置数据，并支持微信授权登录。

## 功能特性

- 📱 设备信息收集（型号、操作系统、屏幕尺寸等）
- 📍 地理位置收集（支持 WGS84、GCJ02 坐标系）
- 🗺️ 多地图服务集成（高德地图、百度地图、腾讯地图）
- 💬 微信授权登录支持
- 💾 PostgreSQL 数据库存储
- 🌐 CORS 跨域支持

## 技术栈

- Node.js (ES Modules)
- PostgreSQL
- 高德地图 API
- 百度地图 API
- 腾讯地图 API
- 微信开放平台 API

## 环境要求

- Node.js >= 14.0.0
- PostgreSQL 数据库

## 安装步骤

1. 克隆仓库
```bash
git clone https://github.com/YOUR_USERNAME/device-collector.git
cd device-collector
```

2. 安装依赖
```bash
npm install
```

3. 配置环境变量

创建 `.env` 文件（或设置系统环境变量）：

```env
# 数据库配置
DATABASE_URL=postgresql://user:password@localhost:5432/dbname

# 微信配置（可选）
WX_APPID=your_wechat_appid
WX_APPSECRET=your_wechat_appsecret
WX_REDIRECT_URI=https://yourdomain.com/

# 地图 API Key（可选，代码中有默认值）
AMAP_KEY=your_amap_key
BAIDU_KEY=your_baidu_key
TENCENT_KEY=your_tencent_key

# 服务器端口（可选，默认 3000）
PORT=3000
```

4. 初始化数据库

执行 `schema.sql` 创建数据表：

```bash
psql -U your_user -d your_database -f schema.sql
```

5. 启动服务

```bash
npm start
```

服务将在 `http://localhost:3000` 启动。

## API 接口

### 健康检查
```
GET /health
```

### 获取地址信息
```
GET /api/address?lat=纬度&lon=经度&coordType=gcj02&includeBaidu=true
```

### 提交设备数据
```
POST /api/device-data
Content-Type: application/json

{
  "timestamp": 1234567890,
  "location": {
    "wgs84": { "lat": 39.9, "lon": 116.4, "accuracy": 10 },
    "gcj02": { "lat": 39.9, "lon": 116.4, "applicable": true }
  },
  "device": {
    "model": "iPhone 12",
    "osVersion": "iOS 15.0",
    "screen": { "width": 390, "height": 844, "dpr": 3 },
    "network": { "type": "wifi", "effectiveType": "4g" }
  },
  "browser": {
    "ua": "Mozilla/5.0..."
  },
  "address": {
    "address": "北京市朝阳区...",
    "country": "中国",
    "province": "北京市",
    "city": "北京市",
    "district": "朝阳区"
  }
}
```

### 微信授权
```
GET /api/wechat/auth-url  # 获取授权 URL
GET /api/wechat/auth?code=xxx  # 授权回调
```

## 项目结构

```
device-collector/
├── server.js          # 服务器主文件
├── db.js              # 数据库连接
├── schema.sql         # 数据库表结构
├── index.html         # 前端页面
├── app.js             # 前端脚本
├── styles.css         # 样式文件
├── package.json       # 项目配置
└── README.md          # 项目说明
```

## 开发调试

1. 确保 PostgreSQL 服务运行
2. 配置数据库连接字符串
3. 运行 `npm start` 启动服务
4. 访问 `http://localhost:3000` 查看前端页面

## 许可证

MIT License

