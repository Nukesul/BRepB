const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const JWT_SECRET = "your_jwt_secret_key";

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

const db = mysql.createPool({
  host: "vh438.timeweb.ru",
  user: "ch79145_boodai",
  password: "16162007",
  database: "ch79145_boodai",
  port: 3306, // Добавлен порт по умолчанию для MySQL
  connectionTimeout: 30000, // Увеличен тайм-аут до 30 секунд
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

    // Check if branches table has address and phone columns
    const [branchColumns] = await connection.query("SHOW COLUMNS FROM branches LIKE 'address'");
    if (branchColumns.length === 0) {
      await connection.query("ALTER TABLE branches ADD COLUMN address VARCHAR(255), ADD COLUMN phone VARCHAR(20)");
      console.log("Добавлены колонки address и phone в таблицу branches");
    }

    // Check if products table has all required columns
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

    // Create subcategories table if not exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS subcategories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category_id INT NOT NULL,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )
    `);

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
    console.error("Ошибка инициализации:", err); // Улучшено логирование с полным объектом ошибки
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

// Общедоступные маршруты (без авторизации)
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

// Админские маршруты (с авторизацией)
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
  const { name, description, priceSmall, priceMedium, priceLarge, priceSingle, branchId, categoryId, subCategoryId, isPizza } = req.body;
  const image = req.file?.filename;

  if (!name || !branchId || !categoryId || !image) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Все обязательные поля должны быть заполнены" });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO products (
        name, description, price_small, price_medium, price_large, price_single, 
        branch_id, category_id, sub_category_id, is_pizza, image
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        isPizza === "true" ? 1 : 0,
        image,
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
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.put("/products/:id", authenticateToken, upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { name, description, priceSmall, priceMedium, priceLarge, priceSingle, branchId, categoryId, subCategoryId, isPizza } = req.body;
  const image = req.file?.filename;

  try {
    const [existing] = await db.query("SELECT image FROM products WHERE id = ?", [id]);
    if (existing.length === 0) {
      if (image) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: "Продукт не найден" });
    }

    const updateImage = image || existing[0].image;

    await db.query(
      `UPDATE products SET 
        name = ?, description = ?, price_small = ?, price_medium = ?, price_large = ?, 
        price_single = ?, branch_id = ?, category_id = ?, sub_category_id = ?, is_pizza = ?, image = ? 
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
        isPizza === "true" ? 1 : 0,
        updateImage,
        id,
      ]
    );

    if (image && existing[0].image) {
      try {
        fs.unlinkSync(path.join(__dirname, "uploads", existing[0].image));
      } catch (err) {
        console.error("Ошибка удаления старого изображения:", err);
      }
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
    if (image) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/products/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [product] = await db.query("SELECT image FROM products WHERE id = ?", [id]);
    if (product.length === 0) return res.status(404).json({ error: "Продукт не найден" });

    if (product[0].image) {
      try {
        fs.unlinkSync(path.join(__dirname, "uploads", product[0].image));
      } catch (err) {
        console.error("Ошибка удаления изображения:", err);
      }
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
  const image = req.file?.filename;
  if (!image) return res.status(400).json({ error: "Изображение обязательно" });

  try {
    const [result] = await db.query("INSERT INTO stories (image) VALUES (?)", [image]);
    res.status(201).json({ id: result.insertId, image });
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
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

app.put("/stories/:id", authenticateToken, upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const image = req.file?.filename;

  try {
    const [existing] = await db.query("SELECT image FROM stories WHERE id = ?", [id]);
    if (existing.length === 0) {
      if (image) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: "История не найдена" });
    }

    const updateImage = image || existing[0].image;
    await db.query("UPDATE stories SET image = ? WHERE id = ?", [updateImage, id]);

    if (image && existing[0].image) {
      try {
        fs.unlinkSync(path.join(__dirname, "uploads", existing[0].image));
      } catch (err) {
        console.error("Ошибка удаления старого изображения:", err);
      }
    }

    res.json({ id, image: updateImage });
  } catch (err) {
    if (image) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.delete("/stories/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [story] = await db.query("SELECT image FROM stories WHERE id = ?", [id]);
    if (story.length === 0) return res.status(404).json({ error: "История не найдена" });

    if (story[0].image) {
      try {
        fs.unlinkSync(path.join(__dirname, "uploads", story[0].image));
      } catch (err) {
        console.error("Ошибка удаления изображения:", err);
      }
    }

    await db.query("DELETE FROM stories WHERE id = ?", [id]);
    res.json({ message: "История удалена" });
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));