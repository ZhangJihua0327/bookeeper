-- Bookeeper v2 schema（幂等，应用每次启动都会执行一遍）

CREATE TABLE IF NOT EXISTS dict_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind VARCHAR(32) NOT NULL COMMENT 'customer / truck_model / location',
  scope VARCHAR(16) NOT NULL DEFAULT 'both' COMMENT 'pump / mixer / both',
  label VARCHAR(128) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dict (kind, scope, label),
  KEY idx_dict_lookup (kind, scope, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS unit_prices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope VARCHAR(16) NOT NULL COMMENT 'pump / mixer',
  customer_name VARCHAR(128) NOT NULL DEFAULT '*' COMMENT '* 表示默认',
  truck_model VARCHAR(64) NOT NULL DEFAULT '*' COMMENT '* 表示默认',
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  note VARCHAR(255) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_price (scope, customer_name, truck_model)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS formula_settings (
  scope VARCHAR(16) NOT NULL,
  volume_formula VARCHAR(500) NOT NULL,
  amount_formula VARCHAR(500) NOT NULL,
  amount_decimals TINYINT UNSIGNED NOT NULL DEFAULT 2,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope VARCHAR(16) NOT NULL COMMENT 'pump / mixer',
  entry_date DATE NOT NULL,
  truck_model VARCHAR(64) NOT NULL DEFAULT '',
  customer_name VARCHAR(128) NOT NULL,
  volume DECIMAL(12,3) NOT NULL DEFAULT 0,
  location VARCHAR(255) NOT NULL DEFAULT '',
  remark VARCHAR(1000) NOT NULL DEFAULT '',
  unit_price_override DECIMAL(12,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_scope_date (scope, entry_date),
  KEY idx_customer (customer_name),
  KEY idx_model (truck_model),
  KEY idx_date (entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
