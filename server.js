require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const axios = require("axios");

const app = express();

// Настройка CORS с конкретным origin
app.use(cors({
  origin: process.env.CLIENT_URL || "https://boodaikg.com",
  credentials: true
}));
app.use(express.json());

// Безопасный JWT_SECRET (рекомендуется заменить в .env)
const JWT_SECRET = process.env.JWT_SECRET || "booday-pizza-secret-2025-long-and-unique-key";

// Настройка S3Client для Timeweb Cloud
const s3Client = new S3Client({
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "DN1NLZTORA2L6NZ529JJ",
    secretAccessKey: process.env.S3_SECRET_KEY || "iGg3syd3UiWzhoYbYlEEDSVX1HHVmWUptrBt81Y8",
  },
  endpoint: process.env.S3_ENDPOINT || "https://s3.twcstorage.ru",
  region: process.env.S3_REGION || "ru-1",
});

const S3_BUCKET = process.env.S3_BUCKET || "4eeafbc6-4af2cd44-4c23-4530-a2bf-750889dfdf75";

// Настройки Telegram
const TELEGRAM_CHAT_ID_BOODAI = process.env.TELEGRAM_CHAT_ID_BOODAI || "-1002311447135";
const TELEGRAM_CHAT_ID_RAION = process.env.TELEGRAM_CHAT_ID_RAION || "-1002638475628";
const TELEGRAM_CHAT_ID_UNKNOWN = process.env.TELEGRAM_CHAT_ID_UNKNOWN || "-1001234567890";

// Проверка подключения к S3
const testS3Connection = async () => {
  try {
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: "test-connection.txt",
      Body: "This is a test file to check S3 connection.",
    });
    await s3Client.send(command);
    console.log("Успешно подключились к S3 и создали тестовый файл!");
  } catch (err) {
    console.error("Ошибка подключения к S3:", err.message);
    throw new Error("Не удалось подключиться к S3: " + err.message);
  }
};

// Настройка multer для загрузки изображений
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // Ограничение по размеру (5MB)
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Только изображения формата JPEG/PNG!"));
  }
}).single("image");

// Функция для загрузки изображения в S3
const uploadToS3 = async (file) => {
  const key = `boody-images/${Date.now()}${path.extname(file.originalname)}`;
  const params = {
    Bucket: S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: "public-read", // Для публичного доступа
  };

  try {
    const upload = new Upload({
      client: s3Client,
      params,
    });
    await upload.done();
    console.log("Изображение успешно загружено в S3:", key);
    return key;
  } catch (err) {
    console.error("Ошибка при загрузке в S3:", err.message);
    throw new Error("Ошибка загрузки в S3: " + err.message);
  }
};

// Функция для получения изображения из S3
const getFromS3 = async (key) => {
  const params = {
    Bucket: S3_BUCKET,
    Key: key,
  };

  try {
    const command = new GetObjectCommand(params);
    const data = await s3Client.send(command);
    return data;
  } catch (err) {
    console.error("Ошибка при получении из S3:", err.message);
    throw new Error("Ошибка получения из S3: " + err.message);
  }
};

// Функция для удаления изображения из S3
const deleteFromS3 = async (key) => {
  const params = {
    Bucket: S3_BUCKET,
    Key: key,
  };

  try {
    const command = new DeleteObjectCommand(params);
    await s3Client.send(command);
    console.log("Изображение успешно удалено из S3:", key);
  } catch (err) {
    console.error("Ошибка удаления из S3:", err.message);
    throw new Error("Ошибка удаления из S3: " + err.message);
  }
};

// Подключение к базе данных
const db = mysql.createPool({
  host: process.env.MYSQL_HOST || "boodaikg.com",
  user: process.env.MYSQL_USER || "ch79145_boodai",
  password: process.env.MYSQL_PASSWORD || "16162007",
  database: process.env.MYSQL_DATABASE || "ch79145_boodai",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Middleware для аутентификации токена
const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Токен отсутствует" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Недействительный токен: " + err.message });
    req.user = user;
    next();
  });
};

// Опциональная аутентификация для маршрута изображений
const optionalAuthenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (!err) req.user = user;
      next();
    });
  } else {
    next();
  }
};

// Маршрут для получения изображения продукта по ключу
app.get("/product-image/:key", optionalAuthenticateToken, async (req, res) => {
  const { key } = req.params;
  try {
    const image = await getFromS3(`boody-images/${key}`);
    res.setHeader("Content-Type", image.ContentType || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000");
    image.Body.pipe(res);
  } catch (err) {
    console.error("Ошибка при отправке изображения клиенту:", err.message);
    res.status(500).json({ error: "Ошибка получения изображения: " + err.message });
  }
});

// Инициализация сервера
const initializeServer = async () => {
  try {
    const connection = await db.getConnection();
    console.log("Подключено к MySQL");

    // Создание необходимых таблиц
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Таблица users проверена/создана");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(255),
        phone VARCHAR(20),
        telegram_chat_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Таблица branches проверена/создана");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Таблица categories проверена/создана");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS subcategories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category_id INT NOT NULL,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Таблица subcategories проверена/создана");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price_small DECIMAL(10,2),
        price_medium DECIMAL(10,2),
        price_large DECIMAL(10,2),
        price_single DECIMAL(10,2),
        branch_id INT NOT NULL,
        category_id INT NOT NULL,
        sub_category_id INT,
        image VARCHAR(255),
        mini_recipe TEXT,
        is_pizza BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        FOREIGN KEY (sub_category_id) REFERENCES subcategories(id) ON DELETE SET NULL
      )
    `);
    console.log("Таблица products проверена/создана");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        total DECIMAL(10,2) NOT NULL,
        status ENUM('pending', 'processing', 'completed', 'cancelled') DEFAULT 'pending',
        order_details JSON,
        delivery_details JSON,
        cart_items JSON,
        discount INT DEFAULT 0,
        promo_code VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      )
    `);
    console.log("Таблица orders проверена/создана");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        discount_percent INT NOT NULL,
        expires_at TIMESTAMP NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Таблица promo_codes проверена/создана");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS discounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        discount_percent INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    console.log("Таблица discounts проверена/создана");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS stories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        image VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Таблица stories проверена/создана");

    // Проверка и добавление колонок в таблицу branches
    const [branchColumns] = await connection.query("SHOW COLUMNS FROM branches LIKE 'address'");
    if (branchColumns.length === 0) {
      await connection.query("ALTER TABLE branches ADD COLUMN address VARCHAR(255), ADD COLUMN phone VARCHAR(20)");
      console.log("Добавлены колонки address и phone в таблицу branches");
    }

    const [telegramColumns] = await connection.query("SHOW COLUMNS FROM branches LIKE 'telegram_chat_id'");
    if (telegramColumns.length === 0) {
      await connection.query("ALTER TABLE branches ADD COLUMN telegram_chat_id VARCHAR(50)");
      console.log("Добавлена колонка telegram_chat_id в таблицу branches");

      await connection.query("UPDATE branches SET telegram_chat_id = ? WHERE name = 'BOODAI PIZZA'", [TELEGRAM_CHAT_ID_BOODAI]);
      await connection.query("UPDATE branches SET telegram_chat_id = ? WHERE name = 'Район'", [TELEGRAM_CHAT_ID_RAION]);
      await connection.query("UPDATE branches SET telegram_chat_id = ? WHERE name = 'Неизвестное действие'", [TELEGRAM_CHAT_ID_UNKNOWN]);
      console.log("Обновлены telegram_chat_id для существующих филиалов");
    }

    // Проверка и добавление колонок в таблицу products
    const [productColumns] = await connection.query("SHOW COLUMNS FROM products");
    const columns = productColumns.map((col) => col.Field);

    if (!columns.includes("mini_recipe")) {
      await connection.query("ALTER TABLE products ADD COLUMN mini_recipe TEXT");
      console.log("Добавлена колонка mini_recipe в таблицу products");
    }

    if (!columns.includes("sub_category_id")) {
      await connection.query("ALTER TABLE products ADD COLUMN sub_category_id INT");
      console.log("Добавлена колонка sub_category_id в таблицу products");
    }

    if (!columns.includes("is_pizza")) {
      await connection.query("ALTER TABLE products ADD COLUMN is_pizza BOOLEAN DEFAULT FALSE");
      console.log("Добавлена колонка is_pizza в таблицу products");
    }

    // Проверка и создание администратора
    const [users] = await connection.query("SELECT * FROM users WHERE email = ?", ["admin@boodaypizza.com"]);
    if (users.length === 0) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      await connection.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", ["Admin", "admin@boodaypizza.com", hashedPassword]);
      console.log("Админ создан: admin@boodaypizza.com / admin123");
    } else {
      console.log("Админ уже существует:", "admin@boodaypizza.com");
    }

    // Проверка и добавление тестовых филиалов
    const [branches] = await connection.query("SELECT * FROM branches");
    if (branches.length === 0) {
      await connection.query("INSERT INTO branches (name, telegram_chat_id) VALUES (?, ?)", ["BOODAI PIZZA", TELEGRAM_CHAT_ID_BOODAI]);
      await connection.query("INSERT INTO branches (name, telegram_chat_id) VALUES (?, ?)", ["Район", TELEGRAM_CHAT_ID_RAION]);
      await connection.query("INSERT INTO branches (name, telegram_chat_id) VALUES (?, ?)", ["Неизвестное действие", TELEGRAM_CHAT_ID_UNKNOWN]);
      console.log("Добавлены тестовые филиалы с telegram_chat_id");
    }

    connection.release();
    await testS3Connection();

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error("Ошибка инициализации сервера:", err.message);
    process.exit(1);
  }
};

// Health check маршрут
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", uptime: process.uptime() });
});

// Публичные маршруты
app.get("/api/public/branches", async (req, res) => {
  try {
    const [branches] = await db.query("SELECT id, name, address, phone FROM branches");
    res.json(branches);
  } catch (err) {
    console.error("Ошибка при получении филиалов:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/api/public/branches/:branchId/products", async (req, res) => {
  const { branchId } = req.params;
  try {
    const [products] = await db.query(`
      SELECT p.id, p.name, p.description, p.price_small, p.price_medium, p.price_large, 
             p.price_single AS price, p.image AS image_url, c.name AS category,
             s.name AS subcategory
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN subcategories s ON p.sub_category_id = s.id
      WHERE p.branch_id = ?
    `, [branchId]);
    res.json(products.map(product => ({
      ...product,
      image_url: product.image_url ? `${process.env.BASE_URL || "https://boodaikg.com"}/product-image/${product.image_url.split("/").pop()}` : null
    })));
  } catch (err) {
    console.error("Ошибка при получении продуктов:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/api/public/branches/:branchId/orders", async (req, res) => {
  const { branchId } = req.params;
  try {
    const [orders] = await db.query(`
      SELECT id, total, created_at, status
      FROM orders
      WHERE branch_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [branchId]);
    res.json(orders);
  } catch (err) {
    console.error("Ошибка при получении истории заказов:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/api/public/stories", async (req, res) => {
  try {
    const [stories] = await db.query("SELECT * FROM stories");
    const storiesWithUrls = stories.map(story => ({
      ...story,
      image: `${process.env.BASE_URL || "https://boodaikg.com"}/product-image/${story.image.split("/").pop()}`
    }));
    res.json(storiesWithUrls);
  } catch (err) {
    console.error("Ошибка при получении историй:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/api/public/validate-promo", async (req, res) => {
  const { promoCode } = req.body;
  if (!promoCode) return res.status(400).json({ error: "Промокод обязателен" });

  try {
    const [promo] = await db.query(
      "SELECT discount_percent AS discount FROM promo_codes WHERE code = ? AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())",
      [promoCode]
    );
    if (promo.length === 0) {
      return res.status(400).json({ message: "Промокод недействителен" });
    }
    res.json({ discount: promo[0].discount });
  } catch (err) {
    console.error("Ошибка при проверке промокода:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/api/public/send-order", async (req, res) => {
  const { orderDetails, deliveryDetails, cartItems, discount, promoCode, branchId } = req.body;

  // Валидация входных данных
  if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
    return res.status(400).json({ error: "Корзина пуста или содержит некорректные данные" });
  }
  if (!branchId) {
    return res.status(400).json({ error: "Не указан филиал (branchId отсутствует)" });
  }
  if (!orderDetails || !deliveryDetails) {
    return res.status(400).json({ error: "Данные заказа и доставки обязательны" });
  }

  try {
    const total = cartItems.reduce((sum, item) => sum + (Number(item.originalPrice) || 0) * (item.quantity || 1), 0);
    const discountedTotal = total * (1 - (discount || 0) / 100);

    const escapeMarkdown = (text) => text ? text.toString().replace(/([_*[\]()~`>#+-.!])/g, '\\$1') : "Нет";

    const orderText = `
📦 *Новый заказ:*
👤 Имя: ${escapeMarkdown(orderDetails.name)}
📞 Телефон: ${escapeMarkdown(orderDetails.phone)}
📝 Комментарии: ${escapeMarkdown(orderDetails.comments)}

🚚 *Доставка:*
👤 Имя: ${escapeMarkdown(deliveryDetails.name)}
📞 Телефон: ${escapeMarkdown(deliveryDetails.phone)}
📍 Адрес: ${escapeMarkdown(deliveryDetails.address)}
📝 Комментарии: ${escapeMarkdown(deliveryDetails.comments)}

🛒 *Товары:*
${cartItems.map((item) => `- ${escapeMarkdown(item.name)} (${item.quantity || 1} шт. по ${Number(item.originalPrice).toFixed(2)} сом)`).join("\n")}

💰 Итоговая стоимость: ${total.toFixed(2)} сом
${promoCode ? `💸 Скидка (${discount}%): ${discountedTotal.toFixed(2)} сом` : "💸 Скидка не применена"}
💰 Итоговая сумма: ${discountedTotal.toFixed(2)} сом
    `;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [result] = await connection.query(`
        INSERT INTO orders (branch_id, total, status, order_details, delivery_details, cart_items, discount, promo_code)
        VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)
      `, [
        branchId,
        discountedTotal,
        JSON.stringify(orderDetails),
        JSON.stringify(deliveryDetails),
        JSON.stringify(cartItems),
        discount || 0,
        promoCode || null
      ]);

      const [branch] = await connection.query("SELECT telegram_chat_id, name FROM branches WHERE id = ?", [branchId]);
      let chatId;

      if (branch.length === 0) {
        throw new Error(`Филиал с id ${branchId} не найден в базе данных`);
      }

      chatId = branch[0].telegram_chat_id;
      if (!chatId) {
        console.warn(`Для филиала с id ${branchId} не указан telegram_chat_id, используем значения по умолчанию`);
        if (parseInt(branchId) === 2) {
          chatId = TELEGRAM_CHAT_ID_RAION;
        } else if (parseInt(branchId) === 3) {
          chatId = TELEGRAM_CHAT_ID_UNKNOWN;
        } else {
          chatId = TELEGRAM_CHAT_ID_BOODAI;
        }
      }

      console.log(`Используем chat_id для филиала ${branch[0].name} (id: ${branchId}): ${chatId}`);

      if (!process.env.TELEGRAM_BOT_TOKEN) {
        throw new Error("TELEGRAM_BOT_TOKEN не указан в переменных окружения");
      }

      // Тестовое сообщение
      try {
        console.log("Проверка доступности chat_id:", chatId);
        const testResponse = await axios.post(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            chat_id: chatId,
            text: "Тестовое сообщение для проверки доступности чата.",
            parse_mode: "Markdown",
          }
        );
        console.log("Тестовое сообщение отправлено:", testResponse.data);
      } catch (testError) {
        console.error("Ошибка при проверке chat_id:", testError.response?.data || testError.message);
        throw new Error("Ошибка проверки Telegram чата: " + (testError.response?.data?.description || testError.message));
      }

      // Отправка заказа
      try {
        console.log("Отправка заказа в chat_id:", chatId);
        const response = await axios.post(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            chat_id: chatId,
            text: orderText,
            parse_mode: "Markdown",
          }
        );
        console.log("Сообщение отправлено в Telegram:", response.data);
      } catch (telegramError) {
        console.error("Ошибка отправки в Telegram:", telegramError.response?.data || telegramError.message);
        throw new Error("Ошибка отправки в Telegram: " + (telegramError.response?.data?.description || telegramError.message));
      }

      await connection.commit();
      res.status(200).json({ message: "Заказ успешно отправлен", orderId: result.insertId });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Ошибка при отправке заказа:", error.message);
    if (error.message.includes("Филиал")) {
      res.status(400).json({ error: error.message });
    } else if (error.message.includes("TELEGRAM_BOT_TOKEN")) {
      res.status(500).json({ error: error.message });
    } else if (error.message.includes("проверки Telegram")) {
      res.status(500).json({ error: error.message });
    } else if (error.message.includes("отправки в Telegram")) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Ошибка сервера: " + error.message });
    }
  }
});

// Остальные маршруты
app.get("/", (req, res) => res.send("Booday Pizza API"));

app.post("/admin/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Введите email и пароль" });

  try {
    const [users] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
    if (users.length === 0) return res.status(401).json({ error: "Неверный email или пароль" });

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Неверный email или пароль" });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "1h" });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error("Ошибка при входе администратора:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/branches", authenticateToken, async (req, res) => {
  try {
    const [branches] = await db.query("SELECT * FROM branches");
    res.json(branches);
  } catch (err) {
    console.error("Ошибка при получении филиалов:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/products", authenticateToken, async (req, res) => {
  try {
    const [products] = await db.query(`
      SELECT p.*, 
             b.name as branch_name, 
             c.name as category_name,
             s.name as subcategory_name
      FROM products p
      LEFT JOIN branches b ON p.branch_id = b.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN subcategories s ON p.sub_category_id = s.id
    `);
    res.json(products.map(product => ({
      ...product,
      image: product.image ? `${process.env.BASE_URL || "https://boodaikg.com"}/product-image/${product.image.split("/").pop()}` : null
    })));
  } catch (err) {
    console.error("Ошибка при получении продуктов:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/discounts", authenticateToken, async (req, res) => {
  try {
    const [discounts] = await db.query(`
      SELECT d.*, p.name as product_name 
      FROM discounts d
      JOIN products p ON d.product_id = p.id
    `);
    res.json(discounts);
  } catch (err) {
    console.error("Ошибка при получении скидок:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/stories", authenticateToken, async (req, res) => {
  try {
    const [stories] = await db.query("SELECT * FROM stories");
    const storiesWithUrls = stories.map(story => ({
      ...story,
      image: `${process.env.BASE_URL || "https://boodaikg.com"}/product-image/${story.image.split("/").pop()}`
    }));
    res.json(storiesWithUrls);
  } catch (err) {
    console.error("Ошибка при получении историй:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/categories", authenticateToken, async (req, res) => {
  try {
    const [categories] = await db.query("SELECT * FROM categories");
    res.json(categories);
  } catch (err) {
    console.error("Ошибка при получении категорий:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/promo-codes", authenticateToken, async (req, res) => {
  try {
    const [promoCodes] = await db.query("SELECT * FROM promo_codes");
    res.json(promoCodes);
  } catch (err) {
    console.error("Ошибка при получении промокодов:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/promo-codes/check/:code", authenticateToken, async (req, res) => {
  const { code } = req.params;
  try {
    const [promo] = await db.query(
      "SELECT * FROM promo_codes WHERE code = ? AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())",
      [code]
    );
    if (promo.length === 0) return res.status(404).json({ error: "Промокод не найден или недействителен" });
    res.json(promo[0]);
  } catch (err) {
    console.error("Ошибка при проверке промокода:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/promo-codes", authenticateToken, async (req, res) => {
  const { code, discountPercent, expiresAt, isActive } = req.body;
  if (!code || !discountPercent) return res.status(400).json({ error: "Код и процент скидки обязательны" });

  try {
    const [existing] = await db.query("SELECT * FROM promo_codes WHERE code = ?", [code]);
    if (existing.length > 0) return res.status(400).json({ error: "Промокод уже существует" });

    const [result] = await db.query(
      "INSERT INTO promo_codes (code, discount_percent, expires_at, is_active) VALUES (?, ?, ?, ?)",
      [code, discountPercent, expiresAt || null, isActive !== undefined ? isActive : true]
    );
    res.status(201).json({ id: result.insertId, code, discount_percent: discountPercent, expires_at: expiresAt || null, is_active: isActive !== undefined ? isActive : true });
  } catch (err) {
    console.error("Ошибка при создании промокода:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/promo-codes/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { code, discountPercent, expiresAt, isActive } = req.body;
  if (!code || !discountPercent) return res.status(400).json({ error: "Код и процент скидки обязательны" });

  try {
    const [existing] = await db.query("SELECT * FROM promo_codes WHERE code = ? AND id != ?", [code, id]);
    if (existing.length > 0) return res.status(400).json({ error: "Промокод уже существует" });

    await db.query(
      "UPDATE promo_codes SET code = ?, discount_percent = ?, expires_at = ?, is_active = ? WHERE id = ?",
      [code, discountPercent, expiresAt || null, isActive !== undefined ? isActive : true, id]
    );
    res.json({ id, code, discount_percent: discountPercent, expires_at: expiresAt || null, is_active: isActive !== undefined ? isActive : true });
  } catch (err) {
    console.error("Ошибка при обновлении промокода:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/promo-codes/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await db.query("SELECT * FROM promo_codes WHERE id = ?", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Промокод не найден" });

    await db.query("DELETE FROM promo_codes WHERE id = ?", [id]);
    res.json({ message: "Промокод удален" });
  } catch (err) {
    console.error("Ошибка при удалении промокода:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/branches", authenticateToken, async (req, res) => {
  const { name, address, phone, telegram_chat_id } = req.body;
  if (!name) return res.status(400).json({ error: "Название филиала обязательно" });

  try {
    const [result] = await db.query(
      "INSERT INTO branches (name, address, phone, telegram_chat_id) VALUES (?, ?, ?, ?)",
      [name, address || null, phone || null, telegram_chat_id || null]
    );
    res.status(201).json({ id: result.insertId, name, address, phone, telegram_chat_id });
  } catch (err) {
    console.error("Ошибка при создании филиала:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/branches/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, address, phone, telegram_chat_id } = req.body;
  if (!name) return res.status(400).json({ error: "Название филиала обязательно" });

  try {
    const [existing] = await db.query("SELECT * FROM branches WHERE id = ?", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Филиал не найден" });

    await db.query(
      "UPDATE branches SET name = ?, address = ?, phone = ?, telegram_chat_id = ? WHERE id = ?",
      [name, address || null, phone || null, telegram_chat_id || null, id]
    );
    res.json({ id, name, address, phone, telegram_chat_id });
  } catch (err) {
    console.error("Ошибка при обновлении филиала:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/branches/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await db.query("SELECT * FROM branches WHERE id = ?", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Филиал не найден" });

    await db.query("DELETE FROM branches WHERE id = ?", [id]);
    res.json({ message: "Филиал удален" });
  } catch (err) {
    console.error("Ошибка при удалении филиала:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/categories", authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Название категории обязательно" });

  try {
    const [result] = await db.query("INSERT INTO categories (name) VALUES (?)", [name]);
    res.status(201).json({ id: result.insertId, name });
  } catch (err) {
    console.error("Ошибка при создании категории:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/categories/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Название категории обязательно" });

  try {
    const [existing] = await db.query("SELECT * FROM categories WHERE id = ?", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Категория не найдена" });

    await db.query("UPDATE categories SET name = ? WHERE id = ?", [name, id]);
    res.json({ id, name });
  } catch (err) {
    console.error("Ошибка при обновлении категории:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/categories/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await db.query("SELECT * FROM categories WHERE id = ?", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Категория не найдена" });

    await db.query("DELETE FROM categories WHERE id = ?", [id]);
    res.json({ message: "Категория удалена" });
  } catch (err) {
    console.error("Ошибка при удалении категории:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/subcategories", authenticateToken, async (req, res) => {
  try {
    const [subcategories] = await db.query(`
      SELECT s.*, c.name as category_name 
      FROM subcategories s
      JOIN categories c ON s.category_id = c.id
    `);
    res.json(subcategories);
  } catch (err) {
    console.error("Ошибка при получении подкатегорий:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/subcategories", authenticateToken, async (req, res) => {
  const { name, categoryId } = req.body;
  if (!name || !categoryId) return res.status(400).json({ error: "Название и категория обязательны" });

  try {
    const [category] = await db.query("SELECT * FROM categories WHERE id = ?", [categoryId]);
    if (category.length === 0) return res.status(400).json({ error: "Категория не найдена" });

    const [result] = await db.query("INSERT INTO subcategories (name, category_id) VALUES (?, ?)", [name, categoryId]);
    const [newSubcategory] = await db.query(
      "SELECT s.*, c.name as category_name FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE s.id = ?",
      [result.insertId]
    );
    res.status(201).json(newSubcategory[0]);
  } catch (err) {
    console.error("Ошибка при создании подкатегории:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/subcategories/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, categoryId } = req.body;
  if (!name || !categoryId) return res.status(400).json({ error: "Название и категория обязательны" });

  try {
    const [existing] = await db.query("SELECT * FROM subcategories WHERE id = ?", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Подкатегория не найдена" });

    const [category] = await db.query("SELECT * FROM categories WHERE id = ?", [categoryId]);
    if (category.length === 0) return res.status(400).json({ error: "Категория не найдена" });

    await db.query("UPDATE subcategories SET name = ?, category_id = ? WHERE id = ?", [name, categoryId, id]);
    const [updatedSubcategory] = await db.query(
      "SELECT s.*, c.name as category_name FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE s.id = ?",
      [id]
    );
    res.json(updatedSubcategory[0]);
  } catch (err) {
    console.error("Ошибка при обновлении подкатегории:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/subcategories/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await db.query("SELECT * FROM subcategories WHERE id = ?", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Подкатегория не найдена" });

    await db.query("DELETE FROM subcategories WHERE id = ?", [id]);
    res.json({ message: "Подкатегория удалена" });
  } catch (err) {
    console.error("Ошибка при удалении подкатегории:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/products", authenticateToken, (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("Ошибка загрузки изображения:", err.message);
      return res.status(400).json({ error: "Ошибка загрузки изображения: " + err.message });
    }

    const { name, description, priceSmall, priceMedium, priceLarge, priceSingle, branchId, categoryId, subCategoryId, miniRecipe, isPizza } = req.body;
    let imageKey;

    if (!req.file) {
      return res.status(400).json({ error: "Изображение обязательно" });
    }

    try {
      imageKey = await uploadToS3(req.file);
    } catch (s3Err) {
      return res.status(500).json({ error: "Ошибка загрузки в S3: " + s3Err.message });
    }

    if (!name || !branchId || !categoryId) {
      return res.status(400).json({ error: "Все обязательные поля должны быть заполнены (name, branchId, categoryId)" });
    }

    try {
      const [branch] = await db.query("SELECT * FROM branches WHERE id = ?", [branchId]);
      if (branch.length === 0) return res.status(400).json({ error: "Филиал не найден" });

      const [category] = await db.query("SELECT * FROM categories WHERE id = ?", [categoryId]);
      if (category.length === 0) return res.status(400).json({ error: "Категория не найдена" });

      if (subCategoryId) {
        const [subcategory] = await db.query("SELECT * FROM subcategories WHERE id = ? AND category_id = ?", [subCategoryId, categoryId]);
        if (subcategory.length === 0) return res.status(400).json({ error: "Подкатегория не найдена или не соответствует категории" });
      }

      const [result] = await db.query(
        `INSERT INTO products (
          name, description, price_small, price_medium, price_large, price_single, 
          branch_id, category_id, sub_category_id, image, mini_recipe, is_pizza
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          description || null,
          priceSmall ? parseFloat(priceSmall) : null,
          priceMedium ? parseFloat(priceMedium) : null,
          priceLarge ? parseFloat(priceLarge) : null,
          priceSingle ? parseFloat(priceSingle) : null,
          branchId,
          categoryId,
          subCategoryId || null,
          imageKey,
          miniRecipe || null,
          isPizza === "true" || isPizza === true ? 1 : 0,
        ]
      );

      const [newProduct] = await db.query(
        `
        SELECT p.*, 
               b.name as branch_name, 
               c.name as category_name,
               s.name as subcategory_name
        FROM products p
        LEFT JOIN branches b ON p.branch_id = b.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN subcategories s ON p.sub_category_id = s.id
        WHERE p.id = ?
      `,
        [result.insertId]
      );

      res.status(201).json({
        ...newProduct[0],
        image: `${process.env.BASE_URL || "https://boodaikg.com"}/product-image/${imageKey.split("/").pop()}`
      });
    } catch (err) {
      console.error("Ошибка при добавлении продукта:", err.message);
      res.status(500).json({ error: "Ошибка сервера: " + err.message });
    }
  });
});

app.put("/products/:id", authenticateToken, (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("Ошибка загрузки изображения:", err.message);
      return res.status(400).json({ error: "Ошибка загрузки изображения: " + err.message });
    }

    const { id } = req.params;
    const { name, description, priceSmall, priceMedium, priceLarge, priceSingle, branchId, categoryId, subCategoryId, miniRecipe, isPizza } = req.body;
    let imageKey;

    try {
      const [existing] = await db.query("SELECT image FROM products WHERE id = ?", [id]);
      if (existing.length === 0) {
        return res.status(404).json({ error: "Продукт не найден" });
      }

      if (req.file) {
        imageKey = await uploadToS3(req.file);
        if (existing[0].image) {
          await deleteFromS3(existing[0].image);
        }
      } else {
        imageKey = existing[0].image;
      }

      const [branch] = await db.query("SELECT * FROM branches WHERE id = ?", [branchId]);
      if (branch.length === 0) return res.status(400).json({ error: "Филиал не найден" });

      const [category] = await db.query("SELECT * FROM categories WHERE id = ?", [categoryId]);
      if (category.length === 0) return res.status(400).json({ error: "Категория не найдена" });

      if (subCategoryId) {
        const [subcategory] = await db.query("SELECT * FROM subcategories WHERE id = ? AND category_id = ?", [subCategoryId, categoryId]);
        if (subcategory.length === 0) return res.status(400).json({ error: "Подкатегория не найдена или не соответствует категории" });
      }

      await db.query(
        `UPDATE products SET 
          name = ?, description = ?, price_small = ?, price_medium = ?, price_large = ?, 
          price_single = ?, branch_id = ?, category_id = ?, sub_category_id = ?, image = ?, 
          mini_recipe = ?, is_pizza = ?
        WHERE id = ?`,
        [
          name,
          description || null,
          priceSmall ? parseFloat(priceSmall) : null,
          priceMedium ? parseFloat(priceMedium) : null,
          priceLarge ? parseFloat(priceLarge) : null,
          priceSingle ? parseFloat(priceSingle) : null,
          branchId,
          categoryId,
          subCategoryId || null,
          imageKey,
          miniRecipe || null,
          isPizza === "true" || isPizza === true ? 1 : 0,
          id,
        ]
      );

      const [updatedProduct] = await db.query(
        `
        SELECT p.*, 
               b.name as branch_name, 
               c.name as category_name,
               s.name as subcategory_name
        FROM products p
        LEFT JOIN branches b ON p.branch_id = b.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN subcategories s ON p.sub_category_id = s.id
        WHERE p.id = ?
      `,
        [id]
      );

      res.json({
        ...updatedProduct[0],
        image: `${process.env.BASE_URL || "https://boodaikg.com"}/product-image/${imageKey.split("/").pop()}`
      });
    } catch (err) {
      console.error("Ошибка при обновлении продукта:", err.message);
      res.status(500).json({ error: "Ошибка сервера: " + err.message });
    }
  });
});

app.delete("/products/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [product] = await db.query("SELECT image FROM products WHERE id = ?", [id]);
    if (product.length === 0) return res.status(404).json({ error: "Продукт не найден" });

    if (product[0].image) {
      await deleteFromS3(product[0].image);
    }

    await db.query("DELETE FROM products WHERE id = ?", [id]);
    res.json({ message: "Продукт удален" });
  } catch (err) {
    console.error("Ошибка при удалении продукта:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/discounts", authenticateToken, async (req, res) => {
  const { productId, discountPercent } = req.body;
  if (!productId || !discountPercent) return res.status(400).json({ error: "ID продукта и процент скидки обязательны" });

  try {
    const [product] = await db.query("SELECT * FROM products WHERE id = ?", [productId]);
    if (product.length === 0) return res.status(400).json({ error: "Продукт не найден" });

    const [result] = await db.query("INSERT INTO discounts (product_id, discount_percent) VALUES (?, ?)", [productId, discountPercent]);
    res.status(201).json({ id: result.insertId, product_id: productId, discount_percent: discountPercent });
  } catch (err) {
    console.error("Ошибка при создании скидки:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/discounts/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { productId, discountPercent } = req.body;
  if (!productId || !discountPercent) return res.status(400).json({ error: "ID продукта и процент скидки обязательны" });

  try {
    const [existing] = await db.query("SELECT * FROM discounts WHERE id = ?", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Скидка не найдена" });

    const [product] = await db.query("SELECT * FROM products WHERE id = ?", [productId]);
    if (product.length === 0) return res.status(400).json({ error: "Продукт не найден" });

    await db.query("UPDATE discounts SET product_id = ?, discount_percent = ? WHERE id = ?", [productId, discountPercent, id]);
    res.json({ id, product_id: productId, discount_percent: discountPercent });
  } catch (err) {
    console.error("Ошибка при обновлении скидки:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/discounts/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await db.query("SELECT * FROM discounts WHERE id = ?", [id]);
    if (existing.length === 0) return res.status(404).json({ error: "Скидка не найдена" });

    await db.query("DELETE FROM discounts WHERE id = ?", [id]);
    res.json({ message: "Скидка удалена" });
  } catch (err) {
    console.error("Ошибка при удалении скидки:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/stories", authenticateToken, (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("Ошибка загрузки изображения:", err.message);
      return res.status(400).json({ error: "Ошибка загрузки изображения: " + err.message });
    }

    let imageKey;

    if (!req.file) {
      return res.status(400).json({ error: "Изображение обязательно" });
    }

    try {
      imageKey = await uploadToS3(req.file);
    } catch (s3Err) {
      return res.status(500).json({ error: "Ошибка загрузки в S3: " + s3Err.message });
    }

    try {
      const [result] = await db.query("INSERT INTO stories (image) VALUES (?)", [imageKey]);
      res.status(201).json({ id: result.insertId, image: `${process.env.BASE_URL || "https://boodaikg.com"}/product-image/${imageKey.split("/").pop()}` });
    } catch (err) {
      console.error("Ошибка при добавлении истории:", err.message);
      res.status(500).json({ error: "Ошибка сервера: " + err.message });
    }
  });
});

app.put("/stories/:id", authenticateToken, (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("Ошибка загрузки изображения:", err.message);
      return res.status(400).json({ error: "Ошибка загрузки изображения: " + err.message });
    }

    const { id } = req.params;
    let imageKey;

    try {
      const [existing] = await db.query("SELECT image FROM stories WHERE id = ?", [id]);
      if (existing.length === 0) {
        return res.status(404).json({ error: "История не найдена" });
      }

      if (req.file) {
        imageKey = await uploadToS3(req.file);
        if (existing[0].image) {
          await deleteFromS3(existing[0].image);
        }
      } else {
        imageKey = existing[0].image;
      }

      await db.query("UPDATE stories SET image = ? WHERE id = ?", [imageKey, id]);
      res.json({ id, image: `${process.env.BASE_URL || "https://boodaikg.com"}/product-image/${imageKey.split("/").pop()}` });
    } catch (err) {
      console.error("Ошибка при обновлении истории:", err.message);
      res.status(500).json({ error: "Ошибка сервера: " + err.message });
    }
  });
});

app.delete("/stories/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [story] = await db.query("SELECT image FROM stories WHERE id = ?", [id]);
    if (story.length === 0) return res.status(404).json({ error: "История не найдена" });

    if (story[0].image) {
      await deleteFromS3(story[0].image);
    }

    await db.query("DELETE FROM stories WHERE id = ?", [id]);
    res.json({ message: "История удалена" });
  } catch (err) {
    console.error("Ошибка при удалении истории:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Все поля обязательны" });
  }

  try {
    const [existingUsers] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: "Пользователь с таким email уже существует" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [name, email, hashedPassword]);
    const token = jwt.sign({ id: result.insertId, email }, JWT_SECRET, { expiresIn: "1h" });
    res.status(201).json({ token, user: { id: result.insertId, name, email } });
  } catch (err) {
    console.error("Ошибка при регистрации:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Введите email и пароль" });
  }

  try {
    const [users] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
    if (users.length === 0) {
      return res.status(401).json({ error: "Неверный email или пароль" });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Неверный email или пароль" });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "1h" });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error("Ошибка при входе:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/users", authenticateToken, async (req, res) => {
  try {
    const [users] = await db.query("SELECT id, name, email FROM users");
    res.json(users);
  } catch (err) {
    console.error("Ошибка при получении пользователей:", err.message);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error("Необработанная ошибка:", err.message);
  res.status(500).json({ error: "Внутренняя ошибка сервера: " + err.message });
});

initializeServer();