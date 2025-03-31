const express = require("express");
const mysql = require("mysql"); // Изменено на обычный mysql
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
  port: 3306, // Оставляем порт
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

// Инициализация базы данных с использованием callbacks
(function initializeDatabase() {
  db.getConnection((err, connection) => {
    if (err) {
      console.error("Ошибка подключения к MySQL:", err);
      return;
    }
    console.log("Подключено к MySQL");

    // Check if branches table has address and phone columns
    connection.query("SHOW COLUMNS FROM branches LIKE 'address'", (err, branchColumns) => {
      if (err) {
        console.error("Ошибка проверки колонок branches:", err);
        connection.release();
        return;
      }
      if (branchColumns.length === 0) {
        connection.query("ALTER TABLE branches ADD COLUMN address VARCHAR(255), ADD COLUMN phone VARCHAR(20)", (err) => {
          if (err) {
            console.error("Ошибка добавления колонок в branches:", err);
          } else {
            console.log("Добавлены колонки address и phone в таблицу branches");
          }
        });
      }

      // Check if products table has all required columns
      connection.query("SHOW COLUMNS FROM products", (err, productColumns) => {
        if (err) {
          console.error("Ошибка проверки колонок products:", err);
          connection.release();
          return;
        }
        const columns = productColumns.map((col) => col.Field);

        if (!columns.includes("mini_recipe")) {
          connection.query("ALTER TABLE products ADD COLUMN mini_recipe TEXT", (err) => {
            if (err) console.error("Ошибка добавления mini_recipe:", err);
            else console.log("Добавлена колонка mini_recipe в таблицу products");
          });
        }

        if (!columns.includes("sub_category_id")) {
          connection.query("ALTER TABLE products ADD COLUMN sub_category_id INT", (err) => {
            if (err) console.error("Ошибка добавления sub_category_id:", err);
            else console.log("Добавлена колонка sub_category_id в таблицу products");
          });
        }

        if (!columns.includes("is_pizza")) {
          connection.query("ALTER TABLE products ADD COLUMN is_pizza BOOLEAN DEFAULT FALSE", (err) => {
            if (err) console.error("Ошибка добавления is_pizza:", err);
            else console.log("Добавлена колонка is_pizza в таблицу products");
          });
        }

        // Create subcategories table if not exists
        connection.query(`
          CREATE TABLE IF NOT EXISTS subcategories (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            category_id INT NOT NULL,
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
          )
        `, (err) => {
          if (err) console.error("Ошибка создания таблицы subcategories:", err);
        });

        // Check and create admin user
        connection.query("SELECT * FROM users WHERE email = ?", ["admin@boodaypizza.com"], (err, users) => {
          if (err) {
            console.error("Ошибка проверки админа:", err);
            connection.release();
            return;
          }
          if (users.length === 0) {
            bcrypt.hash("admin123", 10, (err, hashedPassword) => {
              if (err) {
                console.error("Ошибка хеширования пароля:", err);
                connection.release();
                return;
              }
              connection.query(
                "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
                ["Admin", "admin@boodaypizza.com", hashedPassword],
                (err) => {
                  if (err) console.error("Ошибка создания админа:", err);
                  else console.log("Админ создан: admin@boodaypizza.com / admin123");
                  connection.release();
                }
              );
            });
          } else {
            console.log("Админ уже существует:", "admin@boodaypizza.com");
            connection.release();
          }
        });
      });
    });
  });
})();

app.get("/", (req, res) => res.send("Booday Pizza API"));

app.post("/admin/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Введите email и пароль" });

  db.query("SELECT * FROM users WHERE email = ?", [email], (err, users) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    if (users.length === 0) return res.status(401).json({ error: "Неверный email или пароль" });

    const user = users[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
      if (!isMatch) return res.status(401).json({ error: "Неверный email или пароль" });

      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "1h" });
      res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    });
  });
});

// Общедоступные маршруты (без авторизации)
app.get("/branches", (req, res) => {
  db.query("SELECT * FROM branches", (err, branches) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json(branches);
  });
});

app.get("/products", (req, res) => {
  db.query(`
    SELECT p.*, 
           b.name as branch_name, 
           c.name as category_name,
           s.name as subcategory_name
    FROM products p
    LEFT JOIN branches b ON p.branch_id = b.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN subcategories s ON p.sub_category_id = s.id
  `, (err, products) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json(products);
  });
});

app.get("/discounts", (req, res) => {
  db.query(`
    SELECT d.*, p.name as product_name 
    FROM discounts d
    JOIN products p ON d.product_id = p.id
  `, (err, discounts) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json(discounts);
  });
});

app.get("/stories", (req, res) => {
  db.query("SELECT * FROM stories", (err, stories) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json(stories);
  });
});

app.get("/categories", (req, res) => {
  db.query("SELECT * FROM categories", (err, categories) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json(categories);
  });
});

// Админские маршруты (с авторизацией)
app.post("/branches", authenticateToken, (req, res) => {
  const { name, address, phone } = req.body;
  if (!name) return res.status(400).json({ error: "Название филиала обязательно" });

  db.query("INSERT INTO branches (name, address, phone) VALUES (?, ?, ?)", [name, address || null, phone || null], (err, result) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.status(201).json({ id: result.insertId, name, address, phone });
  });
});

app.put("/branches/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name, address, phone } = req.body;
  if (!name) return res.status(400).json({ error: "Название филиала обязательно" });

  db.query("UPDATE branches SET name = ?, address = ?, phone = ? WHERE id = ?", [name, address || null, phone || null, id], (err) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json({ id, name, address, phone });
  });
});

app.delete("/branches/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM branches WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json({ message: "Филиал удален" });
  });
});

app.post("/categories", authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Название категории обязательно" });

  db.query("INSERT INTO categories (name) VALUES (?)", [name], (err, result) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.status(201).json({ id: result.insertId, name });
  });
});

app.put("/categories/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Название категории обязательно" });

  db.query("UPDATE categories SET name = ? WHERE id = ?", [name, id], (err) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json({ id, name });
  });
});

app.delete("/categories/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM categories WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json({ message: "Категория удалена" });
  });
});

app.get("/subcategories", authenticateToken, (req, res) => {
  db.query(`
    SELECT s.*, c.name as category_name 
    FROM subcategories s
    JOIN categories c ON s.category_id = c.id
  `, (err, subcategories) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json(subcategories);
  });
});

app.post("/subcategories", authenticateToken, (req, res) => {
  const { name, categoryId } = req.body;
  if (!name || !categoryId) return res.status(400).json({ error: "Название и категория обязательны" });

  db.query("INSERT INTO subcategories (name, category_id) VALUES (?, ?)", [name, categoryId], (err, result) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    db.query(
      "SELECT s.*, c.name as category_name FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE s.id = ?",
      [result.insertId],
      (err, newSubcategory) => {
        if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
        res.status(201).json(newSubcategory[0]);
      }
    );
  });
});

app.put("/subcategories/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name, categoryId } = req.body;
  if (!name || !categoryId) return res.status(400).json({ error: "Название и категория обязательны" });

  db.query("UPDATE subcategories SET name = ?, category_id = ? WHERE id = ?", [name, categoryId, id], (err) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    db.query(
      "SELECT s.*, c.name as category_name FROM subcategories s JOIN categories c ON s.category_id = c.id WHERE s.id = ?",
      [id],
      (err, updatedSubcategory) => {
        if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
        res.json(updatedSubcategory[0]);
      }
    );
  });
});

app.delete("/subcategories/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM subcategories WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json({ message: "Подкатегория удалена" });
  });
});

app.post("/products", authenticateToken, upload.single("image"), (req, res) => {
  const { name, description, priceSmall, priceMedium, priceLarge, priceSingle, branchId, categoryId, subCategoryId, isPizza } = req.body;
  const image = req.file?.filename;

  if (!name || !branchId || !categoryId || !image) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Все обязательные поля должны быть заполнены" });
  }

  db.query(
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
    ],
    (err, result) => {
      if (err) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: "Ошибка сервера: " + err.message });
      }
      db.query(
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
        [result.insertId],
        (err, newProduct) => {
          if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
          res.status(201).json(newProduct[0]);
        }
      );
    }
  );
});

app.put("/products/:id", authenticateToken, upload.single("image"), (req, res) => {
  const { id } = req.params;
  const { name, description, priceSmall, priceMedium, priceLarge, priceSingle, branchId, categoryId, subCategoryId, isPizza } = req.body;
  const image = req.file?.filename;

  db.query("SELECT image FROM products WHERE id = ?", [id], (err, existing) => {
    if (err) {
      if (image) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    }
    if (existing.length === 0) {
      if (image) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: "Продукт не найден" });
    }

    const updateImage = image || existing[0].image;

    db.query(
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
      ],
      (err) => {
        if (err) {
          if (image) fs.unlinkSync(req.file.path);
          return res.status(500).json({ error: "Ошибка сервера: " + err.message });
        }

        if (image && existing[0].image) {
          try {
            fs.unlinkSync(path.join(__dirname, "uploads", existing[0].image));
          } catch (err) {
            console.error("Ошибка удаления старого изображения:", err);
          }
        }

        db.query(
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
          [id],
          (err, updatedProduct) => {
            if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
            res.json(updatedProduct[0]);
          }
        );
      }
    );
  });
});

app.delete("/products/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query("SELECT image FROM products WHERE id = ?", [id], (err, product) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    if (product.length === 0) return res.status(404).json({ error: "Продукт не найден" });

    if (product[0].image) {
      try {
        fs.unlinkSync(path.join(__dirname, "uploads", product[0].image));
      } catch (err) {
        console.error("Ошибка удаления изображения:", err);
      }
    }

    db.query("DELETE FROM products WHERE id = ?", [id], (err) => {
      if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
      res.json({ message: "Продукт удален" });
    });
  });
});

app.post("/discounts", authenticateToken, (req, res) => {
  const { productId, discountPercent } = req.body;
  if (!productId || !discountPercent) return res.status(400).json({ error: "ID продукта и процент скидки обязательны" });

  db.query("INSERT INTO discounts (product_id, discount_percent) VALUES (?, ?)", [productId, discountPercent], (err, result) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.status(201).json({ id: result.insertId, product_id: productId, discount_percent: discountPercent });
  });
});

app.put("/discounts/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  const { productId, discountPercent } = req.body;
  if (!productId || !discountPercent) return res.status(400).json({ error: "ID продукта и процент скидки обязательны" });

  db.query("UPDATE discounts SET product_id = ?, discount_percent = ? WHERE id = ?", [productId, discountPercent, id], (err) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json({ id, product_id: productId, discount_percent: discountPercent });
  });
});

app.delete("/discounts/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM discounts WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    res.json({ message: "Скидка удалена" });
  });
});

app.post("/stories", authenticateToken, upload.single("image"), (req, res) => {
  const image = req.file?.filename;
  if (!image) return res.status(400).json({ error: "Изображение обязательно" });

  db.query("INSERT INTO stories (image) VALUES (?)", [image], (err, result) => {
    if (err) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    }
    res.status(201).json({ id: result.insertId, image });
  });
});

// Регистрация пользователя
app.post("/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Все поля обязательны" });
  }

  db.query("SELECT * FROM users WHERE email = ?", [email], (err, existingUsers) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: "Пользователь с таким email уже существует" });
    }

    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
      db.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [name, email, hashedPassword], (err, result) => {
        if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
        const token = jwt.sign({ id: result.insertId, email }, JWT_SECRET, { expiresIn: "1h" });
        res.status(201).json({ token, user: { id: result.insertId, name, email } });
      });
    });
  });
});

// Вход пользователя
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Введите email и пароль" });
  }

  db.query("SELECT * FROM users WHERE email = ?", [email], (err, users) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    if (users.length === 0) {
      return res.status(401).json({ error: "Неверный email или пароль" });
    }

    const user = users[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
      if (!isMatch) {
        return res.status(401).json({ error: "Неверный email или пароль" });
      }

      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "1h" });
      res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
    });
  });
});

app.put("/stories/:id", authenticateToken, upload.single("image"), (req, res) => {
  const { id } = req.params;
  const image = req.file?.filename;

  db.query("SELECT image FROM stories WHERE id = ?", [id], (err, existing) => {
    if (err) {
      if (image) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    }
    if (existing.length === 0) {
      if (image) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: "История не найдена" });
    }

    const updateImage = image || existing[0].image;
    db.query("UPDATE stories SET image = ? WHERE id = ?", [updateImage, id], (err) => {
      if (err) {
        if (image) fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: "Ошибка сервера: " + err.message });
      }

      if (image && existing[0].image) {
        try {
          fs.unlinkSync(path.join(__dirname, "uploads", existing[0].image));
        } catch (err) {
          console.error("Ошибка удаления старого изображения:", err);
        }
      }

      res.json({ id, image: updateImage });
    });
  });
});

app.delete("/stories/:id", authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query("SELECT image FROM stories WHERE id = ?", [id], (err, story) => {
    if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
    if (story.length === 0) return res.status(404).json({ error: "История не найдена" });

    if (story[0].image) {
      try {
        fs.unlinkSync(path.join(__dirname, "uploads", story[0].image));
      } catch (err) {
        console.error("Ошибка удаления изображения:", err);
      }
    }

    db.query("DELETE FROM stories WHERE id = ?", [id], (err) => {
      if (err) return res.status(500).json({ error: "Ошибка сервера: " + err.message });
      res.json({ message: "История удалена" });
    });
  });
});

app.listen(5000, () => console.log("Server running on port 5000"));