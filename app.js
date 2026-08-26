/* =========================================================
   НАСТРОЙКИ МАГАЗИНА — редактируйте здесь
   ========================================================= */
const CONFIG = {
  // Эндпоинт для отправки заявок (FormSubmit.co — активирован)
  FORM_ENDPOINT: "https://formsubmit.co/ajax/919vin@gmail.com",

  // Ссылка на Google-таблицу, опубликованную как CSV (см. README.md, раздел
  // "Живые остатки"). Пока не настроено — сайт работает на статичных
  // данных из products.json.
  STOCK_SHEET_CSV_URL: "",

  SHOP_NAME: "СКЛАД-РАСПРОДАЖА",
  CONTACT_PHONE: "8 (996) 732-36-96",
  CONTACT_PHONE_LINK: "+79967323696",
  CONTACT_EMAIL: "jaks8@list.ru",
  CONTACT_MESSENGER_NOTE: "WhatsApp или Telegram",
  CITY: "Сызрань",

  MIN_ORDER: 20000,
  FREE_CITY_DELIVERY_FROM: 70000,

  DISCOUNT_TIER_1: { from: 300000, rate: 0.02 },
  DISCOUNT_TIER_2: { from: 500000, rate: 0.05 },

  TK_LIST: [
    "СДЭК (CDEK)",
    "ПЭК",
    "Деловые Линии",
    "KIT",
    "Байкал-Сервис",
    "ГлавДоставка",
    "Другая ТК (укажу в комментарии)",
  ],
};

/* ========================================================= */

const CART_STORAGE_KEY = "sklad_opt63_cart";

let PRODUCTS = [];
let cart = loadCartFromStorage(); // id -> qty
let currentCategory = "Рыболовный товар"; // на главной сразу показываем рыболовный товар
let searchQuery = "";
let deliveryBenefit = "discount"; // 'discount' | 'freeTk' — выбор при заказе >= tier2

const fmt = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveCartToStorage() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch (e) {
    // Хранилище недоступно (приватный режим и т.п.) — просто не сохраняем,
    // сайт продолжает работать как обычно в рамках текущей сессии.
  }
}

async function loadProducts() {
  try {
    const res = await fetch("products.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    PRODUCTS = await res.json();
  } catch (err) {
    console.error("Не удалось загрузить каталог:", err);
    document.getElementById("productGrid").innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <b>Каталог не загрузился.</b><br><br>
        Если вы открыли файл двойным кликом с компьютера — браузер блокирует
        загрузку данных из локальных файлов по соображениям безопасности.<br>
        Разместите сайт на хостинге (например, netlify.com/drop) или
        откройте через локальный сервер — подробности в README.md.
      </div>`;
    return;
  }

  try {
    await applyLiveStock();
  } catch (err) {
    console.warn("Живые остатки не подгрузились, показаны данные из products.json:", err);
  }

  // Товары с нулевым остатком на сайте вообще не показываем
  PRODUCTS = PRODUCTS.filter((p) => p.unknownQty || p.qty > 0);

  // Подчищаем сохранённую корзину: убираем товары, которых больше нет
  // в продаже, и подрезаем количество под актуальный остаток.
  let cartChanged = false;
  for (const idStr of Object.keys(cart)) {
    const id = Number(idStr);
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) {
      delete cart[idStr];
      cartChanged = true;
    } else if (!product.unknownQty && cart[idStr] > product.qty) {
      cart[idStr] = product.qty;
      cartChanged = true;
    }
  }
  if (cartChanged) saveCartToStorage();

  // Каталог и категории рендерим сразу после загрузки данных.
  renderCategoryNav();
  renderGrid();
  renderCart(); // важно: перерисовать корзину теперь, когда PRODUCTS уже загружены

  // Прямая ссылка на товар вида index.html#product-123
  const hashMatch = location.hash.match(/^#product-(\d+)$/);
  if (hashMatch) {
    const targetId = Number(hashMatch[1]);
    if (PRODUCTS.some((p) => p.id === targetId)) openProductModal(targetId);
  }
}

async function applyLiveStock() {
  if (!CONFIG.STOCK_SHEET_CSV_URL) return; // ещё не настроено — работаем на статичных данных

  try {
    const res = await fetch(CONFIG.STOCK_SHEET_CSV_URL, { cache: "no-store" });
    const csvText = await res.text();
    const rows = parseCsv(csvText);
    if (rows.length < 2) return;

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idIdx = header.indexOf("id");
    const priceIdx = header.indexOf("цена");
    const qtyIdx = header.indexOf("остаток");
    if (idIdx === -1) return;

    const byId = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const id = Number(row[idIdx]);
      if (!id) continue;
      byId[id] = row;
    }

    PRODUCTS.forEach((p) => {
      const row = byId[p.id];
      if (!row) return;
      if (priceIdx !== -1 && row[priceIdx] !== undefined && row[priceIdx] !== "") {
        const price = Number(String(row[priceIdx]).replace(/[^\d.]/g, ""));
        if (!isNaN(price)) p.price = price;
      }
      if (qtyIdx !== -1) {
        const raw = row[qtyIdx];
        if (raw === undefined || raw === "") {
          p.unknownQty = true;
        } else {
          const qty = Number(String(raw).replace(/[^\d.]/g, ""));
          if (!isNaN(qty)) {
            p.qty = qty;
            p.unknownQty = false;
          }
        }
      }
    });
  } catch (err) {
    console.warn("Не удалось загрузить живые остатки, показаны данные из products.json:", err);
  }
}

// Простой парсер CSV (учитывает кавычки и запятые внутри полей)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

const CATEGORY_ICONS = {
  "Рыболовный товар": "🎣",
  "Хозяйственные товары": "🧰",
  "Автомобильные товары": "🚗",
  "Упаковка": "📦",
  "Оборудование": "🏗️",
};

function renderCategoryNav() {
  const cats = ["Все", ...new Set(PRODUCTS.map((p) => p.category).filter(Boolean))];
  if (!cats.includes(currentCategory)) currentCategory = "Все";
  const nav = document.getElementById("catNav");
  nav.innerHTML = cats
    .map((c) => {
      const icon = CATEGORY_ICONS[c] ? CATEGORY_ICONS[c] + " " : "";
      return `<button class="cat-chip ${c === currentCategory ? "active" : ""}" data-cat="${escapeAttr(c)}">${icon}${escapeHtml(c)}</button>`;
    })
    .join("");
  nav.querySelectorAll(".cat-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentCategory = btn.dataset.cat;
      renderCategoryNav();
      renderGrid();
      window.scrollTo({ top: document.getElementById("productGrid").offsetTop - 90, behavior: "smooth" });
    });
  });
}

function getFilteredProducts() {
  const items = PRODUCTS.filter((p) => {
    const matchCat = currentCategory === "Все" || p.category === currentCategory;
    const matchSearch =
      !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  if (searchQuery) return items; // при поиске порядок не переставляем

  // Хиты (отмечены в прайсе) всегда идут первыми внутри выдачи
  return [...items].sort((a, b) => (b.isHit ? 1 : 0) - (a.isHit ? 1 : 0));
}

function renderGrid() {
  const grid = document.getElementById("productGrid");
  const items = getFilteredProducts();
  if (items.length === 0) {
    grid.innerHTML = `<div class="empty-state">Ничего не найдено по этому запросу.</div>`;
    return;
  }
  grid.innerHTML = items.map((p) => renderCard(p)).join("");
  wireCardEvents(grid);
}

function wireCardEvents(scope) {
  scope.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => openProductModal(Number(el.dataset.view)));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") openProductModal(Number(el.dataset.view));
    });
  });
  scope.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.add);
      const input = scope.querySelector(`[data-qty-input="${id}"]`);
      const product = PRODUCTS.find((p) => p.id === id);
      const max = product.unknownQty ? 9999 : product.qty;
      const qty = Math.max(1, Math.min(max, Number(input.value) || 1));
      input.value = qty;
      addToCart(id, qty);
    });
  });
  scope.querySelectorAll("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      const dir = Number(btn.dataset.step);
      const input = scope.querySelector(`[data-qty-input="${id}"]`);
      const product = PRODUCTS.find((p) => p.id === id);
      const max = product.unknownQty ? 9999 : product.qty;
      let val = Math.max(1, Math.min(max, (Number(input.value) || 1) + dir));
      input.value = val;
    });
  });
  // Ручной ввод количества — подрезаем под остаток сразу, как только
  // пользователь закончил печатать (а не только по кнопкам +/-).
  scope.querySelectorAll("[data-qty-input]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = Number(input.dataset.qtyInput);
      const product = PRODUCTS.find((p) => p.id === id);
      const max = product.unknownQty ? 9999 : product.qty;
      input.value = Math.max(1, Math.min(max, Number(input.value) || 1));
    });
  });
}

function renderCard(p) {
  const soldOut = !p.unknownQty && p.qty <= 0;
  const lowStock = !p.unknownQty && p.qty > 0 && p.qty <= 3;
  const inCartQty = cart[p.id] || 0;
  const isHit = !!p.isHit;
  const isUsedCategory = p.category === "Оборудование";
  const imgTag = p.image
    ? `<img src="${escapeAttr(p.image)}" alt="${escapeAttr(p.name)}" loading="lazy">`
    : `<div style="color:#999;font-size:12px;">Нет фото</div>`;

  const badge = p.unknownQty
    ? `<span class="stock-badge unknown">Уточнить наличие</span>`
    : soldOut
    ? ""
    : `<span class="stock-badge ${lowStock ? "low" : ""}">Осталось: ${p.qty} шт</span>`;

  return `
  <div class="card">
    ${isUsedCategory ? `<span class="top-badge used-badge">Б/У</span>` : isHit ? `<span class="top-badge">🔥 Хит</span>` : ""}
    ${badge}
    ${soldOut ? `<div class="sold-ribbon"><span>Продано</span></div>` : ""}
    <div class="card-img" data-view="${p.id}" role="button" tabindex="0">${imgTag}</div>
    <div class="card-body">
      <div class="card-cat">${escapeHtml(p.category || "")}</div>
      <div class="card-name" data-view="${p.id}" role="button" tabindex="0">${escapeHtml(p.name)}</div>
      ${p.morePhotos ? `<a class="card-more" href="${escapeAttr(p.morePhotos)}" target="_blank" rel="noopener">Больше фото →</a>` : ""}
      <div class="card-bottom">
        <div class="card-price">${fmt(p.price)}<sup> ₽</sup></div>
        ${
          soldOut
            ? ""
            : `<div class="qty-stepper">
                <button type="button" data-step="-1" data-id="${p.id}">−</button>
                <input type="number" min="1" value="1" data-qty-input="${p.id}">
                <button type="button" data-step="1" data-id="${p.id}">+</button>
              </div>`
        }
      </div>
      ${
        soldOut
          ? `<button class="add-btn" disabled>Продано</button>`
          : `<button class="add-btn" data-add="${p.id}">Добавить в заявку</button>`
      }
      ${inCartQty > 0 ? `<div class="in-cart-tag">В заявке: ${inCartQty} шт</div>` : ""}
    </div>
  </div>`;
}

function addToCart(id, qty) {
  const product = PRODUCTS.find((p) => p.id === id);
  const max = product.unknownQty ? 9999 : product.qty;
  const current = cart[id] || 0;
  cart[id] = Math.min(max, current + qty);
  saveCartToStorage();
  renderGrid();
  renderCart();
  pulseCartButton();
}

function pulseCartButton() {
  const btn = document.getElementById("cartBtn");
  btn.classList.remove("pulse");
  void btn.offsetWidth; // restart animation
  btn.classList.add("pulse");
}

function setCartQty(id, qty) {
  const product = PRODUCTS.find((p) => p.id === id);
  const max = product.unknownQty ? 9999 : product.qty;
  if (qty <= 0) {
    delete cart[id];
  } else {
    cart[id] = Math.min(max, qty);
  }
  saveCartToStorage();
  renderCart();
  renderGrid();
}

function getCartItems() {
  return Object.entries(cart).map(([id, qty]) => ({
    product: PRODUCTS.find((p) => p.id === Number(id)),
    qty,
  }));
}

function getSubtotal() {
  return getCartItems().reduce((sum, i) => sum + i.product.price * i.qty, 0);
}

function getDiscountRate(subtotal) {
  if (subtotal >= CONFIG.DISCOUNT_TIER_2.from) return CONFIG.DISCOUNT_TIER_2.rate;
  if (subtotal >= CONFIG.DISCOUNT_TIER_1.from) return CONFIG.DISCOUNT_TIER_1.rate;
  return 0;
}

function renderCart() {
  const body = document.getElementById("drawerBody");
  const items = getCartItems();
  const subtotal = getSubtotal();

  if (items.length === 0) {
    body.innerHTML = `<div class="empty-state">Пока пусто. Добавьте товары из каталога.</div>`;
  } else {
    const progressHtml = renderProgress(subtotal);
    const itemsHtml = items
      .map(
        (i) => `
      <div class="cart-item">
        ${i.product.image ? `<img src="${escapeAttr(i.product.image)}" alt="">` : ""}
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(i.product.name)}</div>
          <div class="cart-item-row">
            <div class="qty-stepper">
              <button type="button" data-cart-step="-1" data-cart-id="${i.product.id}">−</button>
              <input type="number" min="1" value="${i.qty}" data-cart-qty="${i.product.id}">
              <button type="button" data-cart-step="1" data-cart-id="${i.product.id}">+</button>
            </div>
            <div class="cart-item-price">${fmt(i.product.price * i.qty)} ₽</div>
          </div>
          <button class="cart-item-remove" data-remove="${i.product.id}">Удалить</button>
        </div>
      </div>`
      )
      .join("");
    body.innerHTML = progressHtml + itemsHtml;

    body.querySelectorAll("[data-remove]").forEach((btn) =>
      btn.addEventListener("click", () => setCartQty(Number(btn.dataset.remove), 0))
    );
    body.querySelectorAll("[data-cart-step]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.cartId);
        const dir = Number(btn.dataset.cartStep);
        setCartQty(id, (cart[id] || 0) + dir);
      })
    );
    body.querySelectorAll("[data-cart-qty]").forEach((input) =>
      input.addEventListener("change", () => {
        const id = Number(input.dataset.cartQty);
        setCartQty(id, Math.max(1, Number(input.value) || 1));
      })
    );
  }

  document.getElementById("cartCount").textContent = items.reduce((s, i) => s + i.qty, 0);

  const discountRate = getDiscountRate(subtotal);
  const discountAmount = subtotal * discountRate;
  const total = subtotal - discountAmount;

  document.getElementById("summarySubtotal").textContent = fmt(subtotal) + " ₽";
  const discountRow = document.getElementById("summaryDiscountRow");
  if (discountRate > 0) {
    discountRow.style.display = "flex";
    document.getElementById("summaryDiscount").textContent =
      "− " + fmt(discountAmount) + " ₽ (" + Math.round(discountRate * 100) + "%)";
  } else {
    discountRow.style.display = "none";
  }
  document.getElementById("summaryTotal").textContent = fmt(total) + " ₽";

  const checkoutBtn = document.getElementById("checkoutBtn");
  checkoutBtn.disabled = items.length === 0 || subtotal < CONFIG.MIN_ORDER;
}

function renderProgress(subtotal) {
  let html = "";

  if (subtotal < CONFIG.MIN_ORDER) {
    const left = CONFIG.MIN_ORDER - subtotal;
    html += `<div class="progress-box warn">
      Минимальная сумма заказа — ${fmt(CONFIG.MIN_ORDER)} ₽. Добавьте товаров ещё на ${fmt(left)} ₽.
    </div>`;
  }

  if (subtotal < CONFIG.FREE_CITY_DELIVERY_FROM) {
    const left = CONFIG.FREE_CITY_DELIVERY_FROM - subtotal;
    const pct = Math.min(100, (subtotal / CONFIG.FREE_CITY_DELIVERY_FROM) * 100);
    html += `<div class="progress-box">
      До бесплатной доставки по ${CONFIG.CITY} осталось ${fmt(left)} ₽
      <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  } else {
    html += `<div class="progress-box">✓ Бесплатная доставка по ${CONFIG.CITY}</div>`;
  }

  if (subtotal >= CONFIG.DISCOUNT_TIER_2.from) {
    html += `<div class="progress-box">✓ Заказ от ${fmt(CONFIG.DISCOUNT_TIER_2.from)} ₽ — при доставке ТК можно выбрать скидку 5% или бесплатную ТК (выбор при оформлении)</div>`;
  } else if (subtotal >= CONFIG.DISCOUNT_TIER_1.from) {
    html += `<div class="progress-box">✓ Скидка 2% уже применена (заказ от ${fmt(CONFIG.DISCOUNT_TIER_1.from)} ₽)</div>`;
  } else {
    const left = CONFIG.DISCOUNT_TIER_1.from - subtotal;
    html += `<div class="progress-box">До скидки 2% осталось ${fmt(left)} ₽</div>`;
  }

  return html;
}

/* ---------- Drawer open/close ---------- */
function openDrawer() {
  document.getElementById("overlay").classList.add("open");
  document.getElementById("drawer").classList.add("open");
}
function closeDrawer() {
  document.getElementById("overlay").classList.remove("open");
  document.getElementById("drawer").classList.remove("open");
}

/* ---------- Checkout modal ---------- */
function openCheckout() {
  const subtotal = getSubtotal();
  document.getElementById("checkoutOverlay").classList.add("open");
  document.getElementById("checkoutForm").style.display = "block";
  document.getElementById("successView").style.display = "none";

  const tier2Box = document.getElementById("benefitChoiceBox");
  tier2Box.style.display = subtotal >= CONFIG.DISCOUNT_TIER_2.from ? "block" : "none";

  renderTkOptions();
  toggleDeliveryFields();
}

function closeCheckout() {
  document.getElementById("checkoutOverlay").classList.remove("open");
}

function renderTkOptions() {
  const sel = document.getElementById("tkSelect");
  sel.innerHTML = CONFIG.TK_LIST.map((tk) => `<option value="${escapeAttr(tk)}">${escapeHtml(tk)}</option>`).join("");
}

function toggleDeliveryFields() {
  const method = document.querySelector('input[name="delivery"]:checked').value;
  document.getElementById("tkFieldBox").style.display = method === "tk" ? "block" : "none";
  document.getElementById("cityNote").style.display = method === "city" ? "block" : "none";
}

async function submitOrder(e) {
  e.preventDefault();
  const errorBox = document.getElementById("formError");
  errorBox.style.display = "none";

  const name = document.getElementById("custName").value.trim();
  const phone = document.getElementById("custPhone").value.trim();
  const email = document.getElementById("custEmail").value.trim();
  const comment = document.getElementById("custComment").value.trim();
  const deliveryMethod = document.querySelector('input[name="delivery"]:checked').value;
  const tk = deliveryMethod === "tk" ? document.getElementById("tkSelect").value : "";

  if (!name || !phone || !email) {
    errorBox.textContent = "Заполните имя, телефон и email — это обязательные поля.";
    errorBox.style.display = "block";
    return;
  }

  const items = getCartItems();
  const subtotal = getSubtotal();
  const discountRate = getDiscountRate(subtotal);
  const tier2 = subtotal >= CONFIG.DISCOUNT_TIER_2.from;
  const useFreeTk = tier2 && deliveryMethod === "tk" && deliveryBenefit === "freeTk";
  const effectiveDiscountRate = useFreeTk ? 0 : discountRate;
  const discountAmount = subtotal * effectiveDiscountRate;
  const total = subtotal - discountAmount;
  const freeCityDelivery = subtotal >= CONFIG.FREE_CITY_DELIVERY_FROM;

  const deliveryLabel =
    deliveryMethod === "pickup"
      ? "Самовывоз"
      : deliveryMethod === "city"
      ? `Доставка по ${CONFIG.CITY}` + (freeCityDelivery ? " (бесплатно)" : " (стоимость уточняется)")
      : `Транспортная компания: ${tk}` + (useFreeTk ? " (бесплатно — бонус за заказ от " + fmt(CONFIG.DISCOUNT_TIER_2.from) + " ₽)" : " (оплачивает покупатель по тарифам ТК)");

  const itemsText = items
    .map((i) => `• ${i.product.name} — ${i.qty} шт × ${fmt(i.product.price)} ₽ = ${fmt(i.product.price * i.qty)} ₽`)
    .join("\n");

  const message =
    `Новый заказ с сайта ${CONFIG.SHOP_NAME}\n\n` +
    `Товары:\n${itemsText}\n\n` +
    `Сумма товаров: ${fmt(subtotal)} ₽\n` +
    (effectiveDiscountRate > 0 ? `Скидка: ${Math.round(effectiveDiscountRate * 100)}% (− ${fmt(discountAmount)} ₽)\n` : "") +
    `Итого: ${fmt(total)} ₽\n\n` +
    `Доставка: ${deliveryLabel}\n\n` +
    (comment ? `Комментарий: ${comment}\n\n` : "") +
    `Покупатель: ${name}\nТелефон: ${phone}\nEmail: ${email}`;

  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Отправка...";

  try {
    const params = new URLSearchParams();
    params.append("name", name);
    params.append("phone", phone);
    params.append("_replyto", email);
    params.append("message", message);
    params.append("_subject", `Заказ с сайта — ${fmt(total)} ₽ (${name})`);
    params.append("_captcha", "false");
    params.append("_template", "table");

    const res = await fetch(CONFIG.FORM_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: params,
    });

    if (!res.ok) throw new Error("HTTP " + res.status);

    const data = await res.json().catch(() => null);
    if (data && data.success === "false") {
      throw new Error(data.message || "Сервис отклонил отправку");
    }

    document.getElementById("checkoutForm").style.display = "none";
    document.getElementById("successView").style.display = "block";
    cart = {};
    saveCartToStorage();
    renderCart();
    renderGrid();
  } catch (err) {
    errorBox.textContent =
      "Ошибка: " + err.message + ". Позвоните или напишите нам: " + CONFIG.CONTACT_PHONE;
    errorBox.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Отправить заявку";
  }
}

/* ---------- Скачать прайс (генерация Excel в браузере) ---------- */
async function downloadPriceList() {
  const btn = document.getElementById("priceBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Формирую файл...";

  try {
    const baseUrl = location.origin + location.pathname.replace(/index\.html$/, "");
    const categoriesOrder = [...new Set(PRODUCTS.map((p) => p.category))];

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Прайс");
    sheet.properties.defaultColWidth = 14;
    sheet.columns = [
      { width: 45 }, // Название
      { width: 12 }, // Картинка
      { width: 18 }, // Ссылка на товар
      { width: 12 }, // Количество
      { width: 10 }, // Цена
      { width: 16 }, // Количество в заказе
      { width: 14 }, // Сумма
    ];

    // ---- Общая информация сверху ----
    const infoLines = [
      `Минимальная сумма заказа — ${fmt(CONFIG.MIN_ORDER)} рублей.`,
      `При заказе от ${fmt(CONFIG.FREE_CITY_DELIVERY_FROM)} рублей доставка по ${CONFIG.CITY} бесплатная. Условия доставки через транспортные компании обговариваются индивидуально.`,
      `При заказе от ${fmt(CONFIG.DISCOUNT_TIER_1.from)} рублей предоставляется скидка ${Math.round(CONFIG.DISCOUNT_TIER_1.rate * 100)}%, а при заказе от ${fmt(CONFIG.DISCOUNT_TIER_2.from)} рублей — скидка ${Math.round(CONFIG.DISCOUNT_TIER_2.rate * 100)}%.`,
      `В прайсе укажите необходимое количество товаров и отправьте заполненный файл на почту: ${CONFIG.CONTACT_EMAIL}`,
      `Связаться со мной можно по телефону: ${CONFIG.CONTACT_PHONE} — WhatsApp или Telegram.`,
      `Все товары разбиты по категориям.`,
    ];
    infoLines.forEach((line) => {
      const row = sheet.addRow([line]);
      row.font = { italic: true, size: 11 };
      sheet.mergeCells(row.number, 1, row.number, 7);
      row.getCell(1).alignment = { wrapText: true };
    });
    sheet.addRow([]);

    // ---- Заголовок таблицы ----
    const headerRow = sheet.addRow([
      "Название", "Картинка", "Ссылка на товар", "Количество", "Цена", "Количество в заказе", "Сумма",
    ]);
    headerRow.font = { bold: true };
    headerRow.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5C400" } };
    });

    const sumRefs = [];
    const THUMB = 56;

    for (const cat of categoriesOrder) {
      const catRow = sheet.addRow([cat]);
      catRow.font = { bold: true, size: 13 };
      sheet.mergeCells(catRow.number, 1, catRow.number, 7);

      const items = PRODUCTS.filter((p) => p.category === cat);
      for (const p of items) {
        const row = sheet.addRow([
          p.name, "", "", p.unknownQty ? "" : p.qty, p.price, "", "",
        ]);
        const r = row.number;
        sheet.getRow(r).height = THUMB * 0.975;

        // Ссылка на товар — прямая ссылка на карточку на сайте
        row.getCell(3).value = { text: "Открыть на сайте →", hyperlink: `${baseUrl}#product-${p.id}` };
        row.getCell(3).font = { color: { argb: "FF1155CC" }, underline: true };

        // Формула суммы = цена * количество в заказе
        row.getCell(7).value = { formula: `IF(F${r}="","",E${r}*F${r})` };
        sumRefs.push(`G${r}`);

        // Картинка — встраиваем прямо в ячейку
        if (p.image) {
          try {
            const resp = await fetch(p.image);
            const buf = await resp.arrayBuffer();
            const imgId = workbook.addImage({ buffer: buf, extension: "jpeg" });
            sheet.addImage(imgId, {
              tl: { col: 1.05, row: r - 1 + 0.05 },
              ext: { width: THUMB, height: THUMB },
            });
          } catch (e) {
            console.warn("Фото не встроилось для", p.name, e);
          }
        }
      }
    }

    sheet.addRow([]);
    const totalRow = sheet.addRow(["ИТОГО", "", "", "", "", "", { formula: sumRefs.length ? `SUM(${sumRefs.join(",")})` : "0" }]);
    totalRow.font = { bold: true, size: 13 };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `прайс-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Не удалось сформировать прайс:", err);
    alert("Не удалось сформировать файл прайса. Попробуйте ещё раз или обратитесь напрямую по телефону.");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
/* ---------- Модалка товара ---------- */
let modalProductId = null;

function openProductModal(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return;
  modalProductId = id;

  const soldOut = !p.unknownQty && p.qty <= 0;
  const isHit = !!p.isHit;
  const isUsedCategory = p.category === "Оборудование";

  document.getElementById("modalImg").src = p.image || "";
  document.getElementById("modalImg").alt = p.name;
  document.getElementById("modalCat").textContent = p.category || "";
  document.getElementById("modalName").textContent = p.name;
  document.getElementById("modalPrice").innerHTML = fmt(p.price) + "<sup> ₽</sup>";

  const badgeBox = document.getElementById("modalBadges");
  badgeBox.innerHTML = "";
  if (isUsedCategory) badgeBox.innerHTML += `<span class="stock-badge used-badge">Б/У</span>`;
  if (isHit) badgeBox.innerHTML += `<span class="stock-badge hit-badge">🔥 Хит</span>`;
  if (p.unknownQty) badgeBox.innerHTML += `<span class="stock-badge unknown">Уточнить наличие</span>`;
  else if (soldOut) badgeBox.innerHTML += `<span class="stock-badge low">Продано</span>`;
  else badgeBox.innerHTML += `<span class="stock-badge">Осталось: ${p.qty} шт</span>`;

  const specsBox = document.getElementById("modalSpecs");
  const specsSection = document.getElementById("modalSpecsSection");
  const specLines = [];
  if (p.orderIncrement) specLines.push(`Кратность заказа: ${p.orderIncrement} шт`);
  if (p.specs && p.specs.length) specLines.push(...p.specs);
  if (specLines.length) {
    specsBox.innerHTML = `<ul class="modal-specs-list">${specLines.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`;
    specsSection.style.display = "block";
  } else {
    specsBox.innerHTML = "";
    specsSection.style.display = "none";
  }

  document.getElementById("modalDescription").textContent = p.description || "";
  document.getElementById("modalDescription").style.display = p.description ? "block" : "none";

  const moreLink = document.getElementById("modalMorePhotos");
  if (p.morePhotos) {
    moreLink.href = p.morePhotos;
    moreLink.style.display = "inline";
  } else {
    moreLink.style.display = "none";
  }

  const qtyBox = document.getElementById("modalQtyBox");
  const addBtn = document.getElementById("modalAddBtn");
  if (soldOut) {
    qtyBox.style.display = "none";
    addBtn.disabled = true;
    addBtn.textContent = "Продано";
  } else {
    qtyBox.style.display = "flex";
    addBtn.disabled = false;
    addBtn.textContent = "Добавить в заявку";
    document.getElementById("modalQtyInput").value = 1;
  }

  const inCartQty = cart[p.id] || 0;
  document.getElementById("modalInCart").textContent = inCartQty > 0 ? `В заявке: ${inCartQty} шт` : "";

  renderSimilarProducts(p);

  document.getElementById("productModalOverlay").classList.add("open");
  history.replaceState(null, "", "#product-" + p.id);
}

const STOPWORDS = new Set([
  "для", "с", "и", "в", "на", "до", "от", "без", "к", "из", "по", "о", "у",
  "же", "то", "при", "за", "не", "это", "как", "или", "цена", "шт", "мм",
]);

function tokenizeName(name) {
  return name
    .toLowerCase()
    .replace(/["'«»,.()]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function nameSimilarity(tokensA, tokensB) {
  const setB = new Set(tokensB);
  let score = 0;
  for (const t of tokensA) {
    if (setB.has(t)) score += t.length >= 4 ? 2 : 1; // более длинные/специфичные слова весят больше
  }
  return score;
}

function renderSimilarProducts(p) {
  const box = document.getElementById("similarGrid");
  const pTokens = tokenizeName(p.name);
  const candidates = PRODUCTS.filter((x) => x.id !== p.id && (x.unknownQty || x.qty > 0));

  const scored = candidates
    .map((x) => ({
      product: x,
      score:
        nameSimilarity(pTokens, tokenizeName(x.name)) + (x.category === p.category ? 0.5 : 0),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  let similar = scored.slice(0, 5).map((s) => s.product);

  // если совпадений по названию мало — дополняем товарами из той же категории
  if (similar.length < 5) {
    const usedIds = new Set(similar.map((s) => s.id));
    const fallback = candidates.filter((x) => x.category === p.category && !usedIds.has(x.id));
    for (const f of fallback) {
      if (similar.length >= 5) break;
      similar.push(f);
    }
  }

  if (similar.length === 0) {
    box.innerHTML = "";
    document.getElementById("similarSection").style.display = "none";
    return;
  }
  document.getElementById("similarSection").style.display = "block";
  box.innerHTML = similar
    .map(
      (s) => `
    <div class="similar-card" data-view="${s.id}" role="button" tabindex="0">
      ${s.image ? `<img src="${escapeAttr(s.image)}" alt="${escapeAttr(s.name)}">` : ""}
      <div class="similar-name">${escapeHtml(s.name)}</div>
      <div class="similar-price">${fmt(s.price)} ₽</div>
    </div>`
    )
    .join("");
  box.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => openProductModal(Number(el.dataset.view)));
  });
}

function closeProductModal() {
  document.getElementById("productModalOverlay").classList.remove("open");
  modalProductId = null;
  history.replaceState(null, "", location.pathname + location.search);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("shopName").textContent = CONFIG.SHOP_NAME;
  document.getElementById("contactPhone").textContent = CONFIG.CONTACT_PHONE;
  document.getElementById("contactPhone").href = "tel:" + CONFIG.CONTACT_PHONE_LINK;
  document.getElementById("contactEmail").textContent = CONFIG.CONTACT_EMAIL;
  document.getElementById("contactEmail").href = "mailto:" + CONFIG.CONTACT_EMAIL;
  document.getElementById("footerShopName").textContent = "🎣 " + CONFIG.SHOP_NAME;
  document.getElementById("minOrderNote").textContent = fmt(CONFIG.MIN_ORDER);
  document.getElementById("freeDeliveryNote").textContent = fmt(CONFIG.FREE_CITY_DELIVERY_FROM);
  document.getElementById("freeDeliveryNote2").textContent = fmt(CONFIG.FREE_CITY_DELIVERY_FROM);
  document.getElementById("footerPhoneCopy").textContent = CONFIG.CONTACT_PHONE;
  document.getElementById("successPhone").textContent = CONFIG.CONTACT_PHONE;

  loadProducts();

  document.getElementById("searchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    if (searchQuery && currentCategory !== "Все") {
      currentCategory = "Все";
      renderCategoryNav();
    }
    renderGrid();
  });

  document.getElementById("cartBtn").addEventListener("click", openDrawer);
  document.getElementById("priceBtn").addEventListener("click", downloadPriceList);
  document.getElementById("drawerClose").addEventListener("click", closeDrawer);
  document.getElementById("overlay").addEventListener("click", closeDrawer);

  document.getElementById("productModalClose").addEventListener("click", closeProductModal);
  document.getElementById("productModalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "productModalOverlay") closeProductModal();
  });
  document.getElementById("modalStepMinus").addEventListener("click", () => {
    const input = document.getElementById("modalQtyInput");
    const p = PRODUCTS.find((x) => x.id === modalProductId);
    const max = p.unknownQty ? 9999 : p.qty;
    input.value = Math.max(1, Math.min(max, (Number(input.value) || 1) - 1));
  });
  document.getElementById("modalStepPlus").addEventListener("click", () => {
    const input = document.getElementById("modalQtyInput");
    const p = PRODUCTS.find((x) => x.id === modalProductId);
    const max = p.unknownQty ? 9999 : p.qty;
    input.value = Math.max(1, Math.min(max, (Number(input.value) || 1) + 1));
  });
  document.getElementById("modalQtyInput").addEventListener("change", () => {
    const input = document.getElementById("modalQtyInput");
    const p = PRODUCTS.find((x) => x.id === modalProductId);
    if (!p) return;
    const max = p.unknownQty ? 9999 : p.qty;
    input.value = Math.max(1, Math.min(max, Number(input.value) || 1));
  });
  document.getElementById("modalAddBtn").addEventListener("click", () => {
    const input = document.getElementById("modalQtyInput");
    const p = PRODUCTS.find((x) => x.id === modalProductId);
    const max = p.unknownQty ? 9999 : p.qty;
    const qty = Math.max(1, Math.min(max, Number(input.value) || 1));
    input.value = qty;
    addToCart(modalProductId, qty);
    document.getElementById("modalInCart").textContent = `В заявке: ${cart[modalProductId]} шт`;
  });

  document.getElementById("checkoutBtn").addEventListener("click", openCheckout);
  document.getElementById("checkoutClose").addEventListener("click", closeCheckout);
  document.getElementById("checkoutOverlay").addEventListener("click", (e) => {
    if (e.target.id === "checkoutOverlay") closeCheckout();
  });
  document.getElementById("successCloseBtn").addEventListener("click", closeCheckout);

  document.querySelectorAll('input[name="delivery"]').forEach((r) =>
    r.addEventListener("change", toggleDeliveryFields)
  );
  document.querySelectorAll('input[name="benefit"]').forEach((r) =>
    r.addEventListener("change", (e) => {
      deliveryBenefit = e.target.value;
      document.querySelectorAll('input[name="benefit"]').forEach((radio) => {
        radio.closest(".radio-option").classList.toggle("selected", radio.checked);
      });
    })
  );

  document.getElementById("checkoutForm").addEventListener("submit", submitOrder);

  renderCart();
});
