-- 设备数据收集表
CREATE TABLE IF NOT EXISTS device_data (
  id SERIAL PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  ip VARCHAR(45) NOT NULL,
  wgs84_lat DECIMAL(10, 8),
  wgs84_lon DECIMAL(11, 8),
  wgs84_accuracy DECIMAL(10, 2),
  gcj02_lat DECIMAL(10, 8),
  gcj02_lon DECIMAL(11, 8),
  gcj02_applicable BOOLEAN,
  address TEXT,
  country VARCHAR(100),
  province VARCHAR(100),
  city VARCHAR(100),
  district VARCHAR(100),
  street VARCHAR(200),
  adcode VARCHAR(20),
  citycode VARCHAR(20),
  -- 百度地图地址信息
  baidu_address TEXT,
  baidu_country VARCHAR(100),
  baidu_province VARCHAR(100),
  baidu_city VARCHAR(100),
  baidu_district VARCHAR(100),
  baidu_street VARCHAR(200),
  baidu_adcode VARCHAR(20),
  baidu_citycode VARCHAR(20),
  device_model VARCHAR(200),
  os_version VARCHAR(100),
  screen_w INTEGER,
  screen_h INTEGER,
  dpr DECIMAL(5, 2),
  network_type VARCHAR(50),
  effective_type VARCHAR(50),
  ua TEXT,
  wx_openid VARCHAR(100),
  wx_nickname VARCHAR(200),
  wx_headimgurl TEXT,
  wx_sex INTEGER,
  wx_province VARCHAR(100),
  wx_city VARCHAR(100),
  wx_country VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_device_data_timestamp ON device_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_device_data_ip ON device_data(ip);
CREATE INDEX IF NOT EXISTS idx_device_data_wx_openid ON device_data(wx_openid);
CREATE INDEX IF NOT EXISTS idx_device_data_created_at ON device_data(created_at);

