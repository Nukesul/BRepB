const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const AWS = require("aws-sdk");
const multerS3 = require("multer-s3");

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = "your_jwt_secret_key";

// Настройка S3 для Timeweb Cloud
const s3 = new AWS.S3({
  accessKeyId: "DN1NLZTORA2L6NZ529JJ",
  secretAccessKey: "iGg3syd3UiWzhoYbYlEEDSVX1HHVmWUptrBt81Y8",
  endpoint: "https://s3.twcstorage.ru",
  s3ForcePathStyle: true,
  region: "ru-1",
});

// Настройка multer для загрузки в S3
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: "4eeafbc6-4af2cd44-4c23-4530-a2bf-7508089dfdf75", // Правильное имя бакета
    acl: "public-read", // Делаем файлы публично доступными
    key: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));
    },
  }),
});

const db = mysql.createPool({
  host: "vh438.timeweb.ru",
  user: "ch79145_boodai",
  password: "16162007",
  database: "ch79145_boodai",
});

const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Токен отсутствует" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Недействительный токен" });
    req.user = user;
    next();
  });
};

(async () => {
  try {
    const connection = await db.getConnection();
    console.log("Подключено к MySQL");

    // Проверка и создание таблицы branches
    const [branchColumns] = await connection.query("SHOW COLUMNS FROM branches LIKE 'address'");
    if (branchColumns.length === 0) {
      await connection.query("ALTER TABLE branches ADD COLUMN address VARCHAR(255), ADD COLUMN phone VARCHAR(20)");
      console.log("Добавлены колонки address и phone в таблицу branches");
    }

    // Проверка и создание таблицы products
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

    // Создание таблицы subcategories, если не существует
    await connection.query(`
      CREATE TABLE IF NOT EXISTS subcategories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category_id INT NOT NULL,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )
    `);

    // Создание таблицы promo_codes, если не существует
    await connection.query(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        discount_percent INT NOT NULL,
        expires_at TIMESTAMP NULL DEFAULT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Таблица promo_codes проверена/создана");

    // Проверка и создание админа
    const [users] = await connection.query("SELECT * FROM users WHERE email = ?", ["admin@boodaypizza.com"]);
    if (users.length === 0) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      await connection.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", ["Admin", "admin@boodaypizza.com", hashedPassword]);
      console.log("Админ создан: admin@boodaypizza.com / admin123");
    } else {
      console.log("Админ уже существует:", "admin@boodaypizza.com");
    }

    connection.release();
  } catch (err) {
    console.error("Ошибка инициализации:", err.message);
  }
})();

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
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

// Общедоступные маршруты
app.get("/branches", async (req, res) => {
  try {
    const [branches] = await db.query("SELECT * FROM branches");
    res.json(branches);
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/products", async (req, res) => {
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
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/discounts", async (req, res) => {
  try {
    const [discounts] = await db.query(`
      SELECT d.*, p.name as product_name 
      FROM discounts d
      JOIN products p ON d.product_id = p.id
    `);
    res.json(discounts);
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/stories", async (req, res) => {
  try {
    const [stories] = await db.query("SELECT * FROM stories");
    res.json(stories);
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/categories", async (req, res) => {
  try {
    const [categories] = await db.query("SELECT * FROM categories");
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

// Маршруты для промокодов
app.get("/promo-codes", authenticateToken, async (req, res) => {
  try {
    const [promoCodes] = await db.query("SELECT * FROM promo_codes");
    res.json(promoCodes);
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.get("/promo-codes/check/:code", async (req, res) => {
  const { code } = req.params;
  try {
    const [promo] = await db.query("SELECT * FROM promo_codes WHERE code = ? AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())", [code]);
    if (promo.length === 0) return res.status(404).json({ error: "Промокод не найден или недействителен" });
    res.json(promo[0]);
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/promo-codes", authenticateToken, async (req, res) => {
  const { code, discountPercent, expiresAt, isActive } = req.body;
  if (!code || !discountPercent) return res.status(400).json({ error: "Код и процент скидки обязательны" });

  try {
    const [result] = await db.query(
      "INSERT INTO promo_codes (code, discount_percent, expires_at, is_active) VALUES (?, ?, ?, ?)",
      [code, discountPercent, expiresAt || null, isActive !== undefined ? isActive : true]
    );
    res.status(201).json({ id: result.insertId, code, discount_percent: discountPercent, expires_at: expiresAt || null, is_active: isActive !== undefined ? isActive : true });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/promo-codes/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { code, discountPercent, expiresAt, isActive } = req.body;
  if (!code || !discountPercent) return res.status(400).json({ error: "Код и процент скидки обязательны" });

  try {
    await db.query(
      "UPDATE promo_codes SET code = ?, discount_percent = ?, expires_at = ?, is_active = ? WHERE id = ?",
      [code, discountPercent, expiresAt || null, isActive !== undefined ? isActive : true, id]
    );
    res.json({ id, code, discount_percent: discountPercent, expires_at: expiresAt || null, is_active: isActive !== undefined ? isActive : true });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/promo-codes/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM promo_codes WHERE id = ?", [id]);
    res.json({ message: "Промокод удален" });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

// Админские маршруты
app.post("/branches", authenticateToken, async (req, res) => {
  const { name, address, phone } = req.body;
  if (!name) return res.status(400).json({ error: "Название филиала обязательно" });

  try {
    const [result] = await db.query("INSERT INTO branches (name, address, phone) VALUES (?, ?, ?)", [name, address || null, phone || null]);
    res.status(201).json({ id: result.insertId, name, address, phone });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/branches/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, address, phone } = req.body;
  if (!name) return res.status(400).json({ error: "Название филиала обязательно" });

  try {
    await db.query("UPDATE branches SET name = ?, address = ?, phone = ? WHERE id = ?", [name, address || null, phone || null, id]);
    res.json({ id, name, address, phone });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/branches/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM branches WHERE id = ?", [id]);
    res.json({ message: "Филиал удален" });
  } catch (err) {
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
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/categories/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Название категории обязательно" });

  try {
    await db.query("UPDATE categories SET name = ? WHERE id = ?", [name, id]);
    res.json({ id, name });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/categories/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM categories WHERE id = ?", [id]);
    res.json({ message: "Категория удалена" });
  } catch (err) {
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
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/subcategories", authenticateToken, async (req, res) => {
  const { name, categoryId } = req.body;
  if (!name || !categoryId) return res.status(400).json({ error: "Название и категория обязательны" });

  try {
    const [result] = await db.query("INSERT INTO subcategories (name, category_id) VALUES (?, ?)", [name, categoryId]);
    const [newSubcategory] = await db.query(
      "SELECT s.*, c.name as category_name FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE s.id = ?",
      [result.insertId]
    );
    res.status(201).json(newSubcategory[0]);
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/subcategories/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, categoryId } = req.body;
  if (!name || !categoryId) return res.status(400).json({ error: "Название и категория обязательны" });

  try {
    await db.query("UPDATE subcategories SET name = ?, category_id = ? WHERE id = ?", [name, categoryId, id]);
    const [updatedSubcategory] = await db.query(
      "SELECT s.*, c.name as category_name FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE s.id = ?",
      [id]
    );
    res.json(updatedSubcategory[0]);
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/subcategories/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM subcategories WHERE id = ?", [id]);
    res.json({ message: "Подкатегория удалена" });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/products", authenticateToken, upload.single("image"), async (req, res) => {
  const { name, description, priceSmall, priceMedium, priceLarge, priceSingle, branchId, categoryId, subCategoryId } = req.body;
  const imageUrl = req.file?.location; // URL изображения в S3

  if (!name || !branchId || !categoryId || !imageUrl) {
    return res.status(400).json({ error: "Все обязательные поля должны быть заполнены (name, branchId, categoryId, image)" });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO products (
        name, description, price_small, price_medium, price_large, price_single, 
        branch_id, category_id, sub_category_id, image
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        imageUrl,
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

    res.status(201).json(newProduct[0]);
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/products/:id", authenticateToken, upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { name, description, priceSmall, priceMedium, priceLarge, priceSingle, branchId, categoryId, subCategoryId } = req.body;
  const imageUrl = req.file?.location;

  try {
    const [existing] = await db.query("SELECT image FROM products WHERE id = ?", [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: "Продукт не найден" });
    }

    const updateImage = imageUrl || existing[0].image;

    await db.query(
      `UPDATE products SET 
        name = ?, description = ?, price_small = ?, price_medium = ?, price_large = ?, 
        price_single = ?, branch_id = ?, category_id = ?, sub_category_id = ?, image = ? 
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
        updateImage,
        id,
      ]
    );

    // Удаление старого изображения из S3, если загружено новое
    if (imageUrl && existing[0].image) {
      const oldKey = existing[0].image.split("/").pop();
      await s3.deleteObject({ Bucket: "4eeafbc6-4af2cd44-4c23-4530-a2bf-7508089dfdf75", Key: oldKey }).promise();
    }

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

    res.json(updatedProduct[0]);
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/products/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [product] = await db.query("SELECT image FROM products WHERE id = ?", [id]);
    if (product.length === 0) return res.status(404).json({ error: "Продукт не найден" });

    // Удаление изображения из S3
    if (product[0].image) {
      const key = product[0].image.split("/").pop();
      await s3.deleteObject({ Bucket: "4eeafbc6-4af2cd44-4c23-4530-a2bf-7508089dfdf75", Key: key }).promise();
    }

    await db.query("DELETE FROM products WHERE id = ?", [id]);
    res.json({ message: "Продукт удален" });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/discounts", authenticateToken, async (req, res) => {
  const { productId, discountPercent } = req.body;
  if (!productId || !discountPercent) return res.status(400).json({ error: "ID продукта и процент скидки обязательны" });

  try {
    const [result] = await db.query("INSERT INTO discounts (product_id, discount_percent) VALUES (?, ?)", [productId, discountPercent]);
    res.status(201).json({ id: result.insertId, product_id: productId, discount_percent: discountPercent });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/discounts/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { productId, discountPercent } = req.body;
  if (!productId || !discountPercent) return res.status(400).json({ error: "ID продукта и процент скидки обязательны" });

  try {
    await db.query("UPDATE discounts SET product_id = ?, discount_percent = ? WHERE id = ?", [productId, discountPercent, id]);
    res.json({ id, product_id: productId, discount_percent: discountPercent });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/discounts/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM discounts WHERE id = ?", [id]);
    res.json({ message: "Скидка удалена" });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.post("/stories", authenticateToken, upload.single("image"), async (req, res) => {
  const imageUrl = req.file?.location;
  if (!imageUrl) return res.status(400).json({ error: "Изображение обязательно" });

  try {
    const [result] = await db.query("INSERT INTO stories (image) VALUES (?)", [imageUrl]);
    res.status(201).json({ id: result.insertId, image: imageUrl });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/stories/:id", authenticateToken, upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const imageUrl = req.file?.location;

  try {
    const [existing] = await db.query("SELECT image FROM stories WHERE id = ?", [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: "История не найдена" });
    }

    const updateImage = imageUrl || existing[0].image;
    await db.query("UPDATE stories SET image = ? WHERE id = ?", [updateImage, id]);

    // Удаление старого изображения из S3, если загружено новое
    if (imageUrl && existing[0].image) {
      const oldKey = existing[0].image.split("/").pop();
      await s3.deleteObject({ Bucket: "4eeafbc6-4af2cd44-4c23-4530-a2bf-7508089dfdf75", Key: oldKey }).promise();
    }

    res.json({ id, image: updateImage });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/stories/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [story] = await db.query("SELECT image FROM stories WHERE id = ?", [id]);
    if (story.length === 0) return res.status(404).json({ error: "История не найдена" });

    // Удаление изображения из S3
    if (story[0].image) {
      const key = story[0].image.split("/").pop();
      await s3.deleteObject({ Bucket: "4eeafbc6-4af2cd44-4c23-4530-a2bf-7508089dfdf75", Key: key }).promise();
    }

    await db.query("DELETE FROM stories WHERE id = ?", [id]);
    res.json({ message: "История удалена" });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

// Регистрация пользователя
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

// Вход пользователя
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

app.listen(5000, () => console.log("Server running on port 5000"));