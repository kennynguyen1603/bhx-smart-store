(() => {
  "use strict";

  const STORAGE_KEY = "bhx-smart-store-mvp-v1";

  const productCatalog = [
    {
      id: "milk",
      name: "Sữa tươi Vinamilk 100% 1L",
      category: "Sữa & đồ lạnh",
      categoryId: "dairy",
      emoji: "🥛",
      barcode: "8934673574213",
      price: 32600,
      aisle: "Khu đồ lạnh",
      shelf: "Kệ L-02",
      esl: "ESL-L02-08",
      zone: "chilled",
      shelfQty: 3,
      capacity: 18,
      threshold: 4,
      backroomQty: 36,
    },
    {
      id: "noodles",
      name: "Mì Hảo Hảo tôm chua cay gói 75g",
      category: "Mì & thực phẩm khô",
      categoryId: "grocery",
      emoji: "🍜",
      barcode: "8934563138167",
      price: 4500,
      aisle: "Dãy C",
      shelf: "Kệ C-07",
      esl: "ESL-C07-12",
      zone: "aisle-c",
      shelfQty: 7,
      capacity: 24,
      threshold: 6,
      backroomQty: 48,
    },
    {
      id: "yogurt",
      name: "Sữa chua Vinamilk có đường lốc 4 hộp",
      category: "Sữa & đồ lạnh",
      categoryId: "dairy",
      emoji: "🥣",
      barcode: "8934673103222",
      price: 31000,
      aisle: "Khu đồ lạnh",
      shelf: "Kệ L-04",
      esl: "ESL-L04-03",
      zone: "chilled",
      shelfQty: 12,
      capacity: 16,
      threshold: 3,
      backroomQty: 8,
    },
    {
      id: "apple",
      name: "Táo Gala nhập khẩu túi 1kg",
      category: "Rau củ & trái cây",
      categoryId: "produce",
      emoji: "🍎",
      barcode: "2900014825731",
      price: 69900,
      aisle: "Khu rau quả",
      shelf: "Bàn T-03",
      esl: "ESL-T03-01",
      zone: "produce",
      shelfQty: 20,
      capacity: 24,
      threshold: 5,
      backroomQty: 14,
    },
    {
      id: "detergent",
      name: "Nước giặt OMO Matic cửa trên túi 3.6kg",
      category: "Chăm sóc nhà cửa",
      categoryId: "homecare",
      emoji: "🧴",
      barcode: "8934868179070",
      price: 189000,
      aisle: "Dãy D",
      shelf: "Kệ D-11",
      esl: "ESL-D11-06",
      zone: "aisle-d",
      shelfQty: 8,
      capacity: 12,
      threshold: 3,
      backroomQty: 12,
    },
    {
      id: "bread",
      name: "Bánh mì sandwich lúa mạch 300g",
      category: "Bánh & đồ ăn nhanh",
      categoryId: "bakery",
      emoji: "🍞",
      barcode: "8938502520167",
      price: 28500,
      aisle: "Dãy A",
      shelf: "Kệ A-02",
      esl: "ESL-A02-04",
      zone: "aisle-a",
      shelfQty: 6,
      capacity: 10,
      threshold: 2,
      backroomQty: 4,
    },
  ];

  const categoryCatalog = [
    { id: "produce", name: "Rau củ & trái cây", emoji: "🥬" },
    { id: "dairy", name: "Sữa & đồ lạnh", emoji: "🥛" },
    { id: "grocery", name: "Thực phẩm khô", emoji: "🍜" },
    { id: "bakery", name: "Bánh & ăn nhanh", emoji: "🥖" },
    { id: "homecare", name: "Chăm sóc nhà", emoji: "🧴" },
  ];

  const initialState = {
    products: productCatalog.reduce((result, product) => {
      result[product.id] = { shelfQty: product.shelfQty, backroomQty: product.backroomQty };
      return result;
    }, {}),
    tasks: [
      {
        id: "task-restock-milk",
        type: "restock",
        productId: "milk",
        priority: "high",
        status: "pending",
        createdAt: "08:05",
        title: "Bổ sung kệ sữa tươi",
        note: "Tồn kệ dưới ngưỡng · LED đang nháy",
        ledActive: true,
      },
      {
        id: "task-fefo-yogurt",
        type: "fefo",
        productId: "yogurt",
        priority: "medium",
        status: "pending",
        createdAt: "07:30",
        title: "Dán nhãn giảm giá FEFO",
        note: "Lô L241111 · Còn 2 ngày sử dụng",
        batch: "L241111",
        expiry: "15/11/2026",
        markdown: 20,
      },
      {
        id: "task-restock-apple",
        type: "restock",
        productId: "apple",
        priority: "normal",
        status: "completed",
        createdAt: "07:42",
        completedAt: "07:58",
        title: "Bổ sung quầy táo Gala",
        note: "Đã bổ sung 12 sản phẩm",
        ledActive: false,
      },
    ],
    activities: [
      { id: "a1", type: "restock", title: "Đã bổ sung 12 × Táo Gala", detail: "Bàn T-03 · Tồn kệ 8 → 20", time: "07:58" },
      { id: "a2", type: "sync", title: "DC WMS cập nhật tồn kho sau cửa hàng", detail: "14 SKU được đồng bộ", time: "07:45" },
      { id: "a3", type: "login", title: "Bắt đầu ca làm việc", detail: "BHX Nguyễn Trãi · Ca sáng", time: "07:30" },
    ],
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let state = loadState();
  let taskFilter = "all";
  let sessionSeconds = 120;
  let sessionInterval = null;

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!stored || !stored.products || !Array.isArray(stored.tasks)) return clone(initialState);
      return stored;
    } catch {
      return clone(initialState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getProduct(id) {
    const base = productCatalog.find((product) => product.id === id);
    if (!base) return null;
    return { ...base, ...state.products[id] };
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase();
  }

  function icon(name) {
    return `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
  }

  function showScreen(screenId) {
    $$(".screen").forEach((screen) => screen.classList.toggle("is-active", screen.id === screenId));
    const isMode = screenId === "mode-screen";
    $("#app-bar").classList.toggle("is-hidden", !isMode);
    document.body.classList.toggle("is-kiosk", screenId === "kiosk-screen");
    closeModal();
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (screenId === "staff-screen") renderStaff();
    if (screenId === "kiosk-screen") {
      resetKioskHome(false);
      startSessionTimer();
    } else {
      stopSessionTimer();
    }
  }

  function renderStaff() {
    const pending = state.tasks.filter((task) => task.status === "pending");
    const priorityCount = pending.filter((task) => task.priority !== "normal").length;
    const lowCount = productCatalog.filter((product) => getProduct(product.id).shelfQty <= product.threshold).length;
    const fefoCount = pending.filter((task) => task.type === "fefo").length;
    const completionRate = Math.round((state.tasks.filter((task) => task.status === "completed").length / state.tasks.length) * 100);

    $("#nav-task-count").textContent = pending.length;
    $("#notification-count").textContent = pending.length;
    $("#priority-copy").textContent = `${priorityCount} nhiệm vụ ưu tiên`;

    $("#metric-grid").innerHTML = [
      { label: "Nhiệm vụ mở", value: pending.length, helper: `${priorityCount} cần ưu tiên`, icon: "tasks", className: "" },
      { label: "Kệ sắp hết", value: lowCount, helper: "Theo dữ liệu POS", icon: "alert", className: "is-alert" },
      { label: "Nhãn FEFO", value: fefoCount, helper: "Cần xử lý hôm nay", icon: "calendar", className: "is-fefo" },
      { label: "Hoàn thành ca", value: `${completionRate}%`, helper: `${state.tasks.filter((t) => t.status === "completed").length}/${state.tasks.length} nhiệm vụ`, icon: "check", className: "" },
    ]
      .map(
        (metric) => `
          <article class="metric-card ${metric.className}">
            <span class="metric-icon">${icon(metric.icon)}</span>
            <span class="metric-copy"><span>${metric.label}</span><strong>${metric.value}</strong><small>${metric.helper}</small></span>
          </article>`,
      )
      .join("");

    const priorityTasks = pending
      .slice()
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
      .slice(0, 3);
    $("#priority-task-list").innerHTML = priorityTasks.length
      ? priorityTasks.map(taskRowMarkup).join("")
      : emptyStateMarkup("Bạn đã xử lý hết nhiệm vụ ưu tiên", "Dữ liệu mới từ POS và FEFO sẽ xuất hiện tại đây.");

    renderAllTasks();
    renderShelfStatus();
    renderActivity();
  }

  function priorityRank(priority) {
    return { high: 0, medium: 1, normal: 2 }[priority] ?? 3;
  }

  function taskRowMarkup(task) {
    const product = getProduct(task.productId);
    const typeIcon = task.type === "fefo" ? "calendar" : "package";
    const typeClass = task.type === "fefo" ? "is-fefo" : task.priority === "high" ? "is-critical" : "";
    const priorityLabel = { high: "Khẩn cấp", medium: "Ưu tiên", normal: "Bình thường" }[task.priority];
    const statusMarkup = task.status === "completed"
      ? `<span class="task-status completed">Đã hoàn thành</span>`
      : `<span class="priority-badge ${task.priority}">${priorityLabel}</span>`;

    return `
      <button class="task-row ${typeClass}" type="button" data-task-id="${task.id}">
        <span class="task-type-icon">${icon(typeIcon)}</span>
        <span class="task-main">
          <strong>${escapeHtml(task.title)}</strong>
          <span>${escapeHtml(product.name)} · ${escapeHtml(product.shelf)}</span>
        </span>
        <span class="task-meta">${statusMarkup}<span class="task-time">${task.status === "completed" ? `Xong ${task.completedAt}` : `Tạo lúc ${task.createdAt}`}</span></span>
      </button>`;
  }

  function renderAllTasks() {
    let tasks = state.tasks.slice().sort((a, b) => {
      if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
      return priorityRank(a.priority) - priorityRank(b.priority);
    });

    if (taskFilter === "completed") tasks = tasks.filter((task) => task.status === "completed");
    else if (taskFilter !== "all") tasks = tasks.filter((task) => task.type === taskFilter && task.status === "pending");

    $("#all-task-list").innerHTML = tasks.length
      ? tasks.map(taskRowMarkup).join("")
      : emptyStateMarkup("Chưa có nhiệm vụ phù hợp", "Hãy chọn bộ lọc khác để xem công việc trong ca.");
  }

  function renderShelfStatus() {
    const featured = ["milk", "noodles", "apple"];
    $("#shelf-status-list").innerHTML = featured
      .map((id) => {
        const product = getProduct(id);
        const percent = Math.max(0, Math.min(100, Math.round((product.shelfQty / product.capacity) * 100)));
        const levelClass = product.shelfQty <= product.threshold ? "is-low" : percent < 45 ? "is-medium" : "";
        return `
          <div class="shelf-row ${levelClass}">
            <div class="shelf-row-top"><strong>${escapeHtml(product.name)}</strong><span>${product.shelfQty}/${product.capacity}</span></div>
            <div class="stock-bar"><i style="width:${percent}%"></i></div>
          </div>`;
      })
      .join("");
  }

  function renderActivity() {
    $("#activity-list").innerHTML = state.activities
      .slice(0, 12)
      .map((activity) => {
        const activityIcon = activity.type === "restock" ? "package" : activity.type === "sync" ? "layers" : "clock";
        return `
          <div class="activity-row">
            <span class="activity-icon">${icon(activityIcon)}</span>
            <div><strong>${escapeHtml(activity.title)}</strong><span>${escapeHtml(activity.detail)}</span></div>
            <time>${escapeHtml(activity.time)}</time>
          </div>`;
      })
      .join("");
  }

  function emptyStateMarkup(title, copy) {
    return `
      <div style="padding:32px 18px;text-align:center;border:1px dashed var(--line);border-radius:14px;color:var(--muted)">
        <span style="display:inline-grid;place-items:center;width:42px;height:42px;border-radius:50%;background:var(--green-50);color:var(--green-700)">${icon("check")}</span>
        <strong style="display:block;margin:10px 0 5px;color:var(--ink);font-size:12px">${title}</strong>
        <small style="font-size:9px">${copy}</small>
      </div>`;
  }

  function switchStaffTab(tab) {
    $$("[data-staff-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.staffTab === tab));
    $$(".staff-tab-panel").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === tab));
    if (tab === "tasks") renderAllTasks();
  }

  function openTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const product = getProduct(task.productId);

    if (task.status === "completed") {
      openModal(`
        <div class="modal-header"><span class="section-kicker">NHIỆM VỤ ĐÃ HOÀN THÀNH</span><h2>${escapeHtml(task.title)}</h2><p>Hoàn thành lúc ${task.completedAt} bởi Nguyễn Hoàng An.</p></div>
        <div class="modal-body">
          ${productDetailMarkup(product)}
          <div class="detail-grid">
            <span class="detail-stat"><span>Trạng thái</span><strong>Đã đối soát</strong></span>
            <span class="detail-stat"><span>Ghi nhận</span><strong>${escapeHtml(task.note)}</strong></span>
          </div>
        </div>
        <div class="modal-footer"><button class="secondary-button" type="button" data-action="close-modal">Đóng</button></div>`);
      return;
    }

    if (task.type === "fefo") {
      openFefoTask(task, product);
      return;
    }

    openModal(`
      <div class="modal-header"><span class="section-kicker">BỔ SUNG HÀNG · ${task.priority === "high" ? "KHẨN CẤP" : "ƯU TIÊN"}</span><h2>${escapeHtml(task.title)}</h2><p>Kiểm tra đúng vị trí và quét ESL trước khi cập nhật số lượng.</p></div>
      <div class="modal-body">
        ${productDetailMarkup(product)}
        <div class="detail-grid">
          <span class="detail-stat"><span>Tồn trên kệ</span><strong>${product.shelfQty}/${product.capacity} sản phẩm</strong></span>
          <span class="detail-stat"><span>Tồn kho sau</span><strong>${product.backroomQty} sản phẩm</strong></span>
          <span class="detail-stat"><span>Ngưỡng cảnh báo</span><strong>≤ ${product.threshold}</strong></span>
          <span class="detail-stat"><span>ESL liên kết</span><strong>${product.esl}</strong></span>
        </div>
        ${task.ledActive ? `<div class="led-status"><i></i> Đèn LED trên ESL đang nháy để đánh dấu vị trí</div>` : ""}
      </div>
      <div class="modal-footer">
        <button class="secondary-button" type="button" data-action="close-modal">Để sau</button>
        <button class="primary-button" type="button" data-action="scan-task" data-task="${task.id}">${icon("scan")} Quét ESL để bắt đầu</button>
      </div>`);
  }

  function productDetailMarkup(product) {
    return `
      <div class="detail-product">
        <span class="detail-product-icon">${product.emoji}</span>
        <span><small>${escapeHtml(product.category)}</small><strong>${escapeHtml(product.name)}</strong><small>Mã: ${product.barcode}</small></span>
        <span>${escapeHtml(product.shelf)}</span>
      </div>`;
  }

  function openFefoTask(task, product) {
    openModal(`
      <div class="modal-header"><span class="section-kicker">FEFO · XỬ LÝ TRƯỚC HẠN</span><h2>${escapeHtml(task.title)}</h2><p>Ưu tiên lô gần hết hạn lên trước và xác nhận nhãn giảm giá.</p></div>
      <div class="modal-body">
        ${productDetailMarkup(product)}
        <div class="detail-grid">
          <span class="detail-stat"><span>Mã lô</span><strong>${task.batch}</strong></span>
          <span class="detail-stat"><span>Hạn sử dụng</span><strong>${task.expiry}</strong></span>
          <span class="detail-stat"><span>Số lượng lô</span><strong>8 sản phẩm</strong></span>
          <span class="detail-stat"><span>Vị trí</span><strong>${product.shelf}</strong></span>
        </div>
        <div class="fefo-banner">${icon("calendar")}<span><strong>Lô hàng cần được xử lý hôm nay</strong><small>FEFO Engine đề xuất giảm giá dựa trên thời gian sử dụng còn lại.</small></span></div>
        <div class="markdown-preview"><span><small>NHÃN GIẢM GIÁ ĐỀ XUẤT</small><strong>Ưu tiên bán trước</strong></span><b>-${task.markdown}%</b></div>
      </div>
      <div class="modal-footer">
        <button class="secondary-button" type="button" data-action="close-modal">Để sau</button>
        <button class="primary-button" type="button" data-action="complete-fefo" data-task="${task.id}">${icon("check")} Xác nhận đã dán nhãn</button>
      </div>`);
  }

  function openScan(taskId) {
    let task = taskId ? state.tasks.find((item) => item.id === taskId) : null;
    if (!task) task = state.tasks.find((item) => item.type === "restock" && item.status === "pending");
    const product = task ? getProduct(task.productId) : getProduct("milk");

    openModal(`
      <div class="modal-header"><span class="section-kicker">QUÉT MÃ KỆ HÀNG</span><h2>Đưa mã ESL vào khung quét</h2><p>Ứng dụng sẽ tự nhận diện sản phẩm và vị trí kệ đã liên kết.</p></div>
      <div class="modal-body">
        <div class="scan-stage"><span class="scan-code"><strong>${product.esl}</strong><small>ELECTRONIC SHELF LABEL</small></span></div>
        <p class="scan-caption">Demo không sử dụng camera. Nhấn nút bên dưới để mô phỏng quét mã.</p>
      </div>
      <div class="modal-footer">
        <button class="secondary-button" type="button" data-action="close-modal">Hủy</button>
        <button class="primary-button" type="button" data-action="scan-success" data-task="${task ? task.id : ""}">${icon("scan")} Mô phỏng quét ${product.esl}</button>
      </div>`);
  }

  function openRestockForm(taskId) {
    const task = state.tasks.find((item) => item.id === taskId) || state.tasks.find((item) => item.type === "restock" && item.status === "pending");
    if (!task) {
      showToast("Không có nhiệm vụ", "Chưa có kệ nào cần bổ sung hàng.");
      closeModal();
      return;
    }
    const product = getProduct(task.productId);
    const suggested = Math.min(product.capacity - product.shelfQty, product.backroomQty);

    openModal(`
      <div class="modal-header"><span class="section-kicker">ĐÃ NHẬN DIỆN ESL</span><h2>Cập nhật số lượng lên kệ</h2><p>Kiểm đếm số lượng thực tế trước khi xác nhận.</p></div>
      <div class="modal-body">
        ${productDetailMarkup(product)}
        <div class="detail-grid">
          <span class="detail-stat"><span>Tồn kệ hiện tại</span><strong>${product.shelfQty} sản phẩm</strong></span>
          <span class="detail-stat"><span>Sức chứa kệ</span><strong>${product.capacity} sản phẩm</strong></span>
        </div>
        <div class="quantity-section">
          <label for="restock-quantity">Số lượng bổ sung</label>
          <div class="quantity-control">
            <button type="button" data-action="quantity-down" aria-label="Giảm số lượng">${icon("minus")}</button>
            <input id="restock-quantity" type="number" min="1" max="${suggested}" value="${suggested}" inputmode="numeric" />
            <button type="button" data-action="quantity-up" aria-label="Tăng số lượng">${icon("plus")}</button>
          </div>
          <div class="quantity-help"><span>Đề xuất: ${suggested}</span><span>Tối đa: ${suggested}</span></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="secondary-button" type="button" data-action="close-modal">Hủy</button>
        <button class="primary-button" type="button" data-action="confirm-restock" data-task="${task.id}" data-max="${suggested}">${icon("check")} Xác nhận cập nhật</button>
      </div>`);
  }

  function confirmRestock(taskId, max) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const product = getProduct(task.productId);
    const input = $("#restock-quantity");
    const quantity = Math.max(1, Math.min(Number(input?.value) || 1, Number(max)));
    const previous = product.shelfQty;
    state.products[product.id].shelfQty = Math.min(product.capacity, product.shelfQty + quantity);
    state.products[product.id].backroomQty = Math.max(0, product.backroomQty - quantity);
    task.status = "completed";
    task.completedAt = currentTime();
    task.ledActive = false;
    task.note = `Đã bổ sung ${quantity} sản phẩm`;
    state.activities.unshift({
      id: `activity-${Date.now()}`,
      type: "restock",
      title: `Đã bổ sung ${quantity} × ${product.name}`,
      detail: `${product.shelf} · Tồn kệ ${previous} → ${state.products[product.id].shelfQty}`,
      time: currentTime(),
    });
    saveState();
    closeModal();
    renderStaff();
    showToast("Cập nhật tồn kệ thành công", `LED ${product.esl} đã tắt · Nhiệm vụ hoàn tất.`);
  }

  function completeFefo(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const product = getProduct(task.productId);
    task.status = "completed";
    task.completedAt = currentTime();
    task.note = `Đã dán nhãn giảm ${task.markdown}% cho lô ${task.batch}`;
    state.activities.unshift({
      id: `activity-${Date.now()}`,
      type: "restock",
      title: `Đã hoàn tất nhãn FEFO · ${product.name}`,
      detail: `Lô ${task.batch} · Giảm ${task.markdown}%`,
      time: currentTime(),
    });
    saveState();
    closeModal();
    renderStaff();
    showToast("Đã hoàn tất nhiệm vụ FEFO", `Lô ${task.batch} được đánh dấu ưu tiên bán trước.`);
  }

  function simulateSale() {
    const product = getProduct("noodles");
    const previous = product.shelfQty;
    const next = Math.max(0, previous - 2);
    state.products[product.id].shelfQty = next;

    let created = false;
    if (next <= product.threshold) {
      let task = state.tasks.find((item) => item.productId === product.id && item.type === "restock" && item.status === "pending");
      if (!task) {
        task = {
          id: `task-restock-${product.id}-${Date.now()}`,
          type: "restock",
          productId: product.id,
          priority: next <= Math.floor(product.threshold / 2) ? "high" : "medium",
          status: "pending",
          createdAt: currentTime(),
          title: "Bổ sung kệ mì ăn liền",
          note: "POS vừa ghi nhận tồn kệ dưới ngưỡng",
          ledActive: true,
        };
        state.tasks.unshift(task);
        created = true;
      }
    }

    state.activities.unshift({
      id: `activity-${Date.now()}`,
      type: "sync",
      title: "POS ghi nhận bán 2 sản phẩm",
      detail: `${product.name} · Tồn kệ ${previous} → ${next}`,
      time: currentTime(),
    });
    saveState();
    renderStaff();

    if (created) {
      showToast("Kệ C-07 sắp hết hàng", "Đã bật LED ESL và tạo nhiệm vụ bổ sung mới.", "warning");
    } else if (next <= product.threshold) {
      showToast("Tồn kệ tiếp tục giảm", `Kệ C-07 còn ${next} sản phẩm. Nhiệm vụ đang mở.`, "warning");
    } else {
      showToast("POS đã đồng bộ", `Tồn kệ mì Hảo Hảo: ${previous} → ${next}.`);
    }
  }

  function currentTime() {
    return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  }

  function renderCategories() {
    $("#category-grid").innerHTML = categoryCatalog
      .map(
        (category) => `
          <button class="category-card" type="button" data-category="${category.id}">
            <span class="category-emoji">${category.emoji}</span><strong>${escapeHtml(category.name)}</strong>
          </button>`,
      )
      .join("");
  }

  function searchProducts(query = "", categoryId = null) {
    const normalized = normalizeText(query.trim());
    const products = productCatalog.filter((product) => {
      const categoryMatch = !categoryId || product.categoryId === categoryId;
      const textMatch = !normalized || normalizeText(`${product.name} ${product.category} ${product.barcode}`).includes(normalized);
      return categoryMatch && textMatch;
    });
    showKioskResults(products, query, categoryId);
  }

  function showKioskResults(products, query, categoryId) {
    $("#kiosk-home-view").hidden = true;
    $("#kiosk-results-view").hidden = false;
    const category = categoryCatalog.find((item) => item.id === categoryId);
    $("#results-title").textContent = category ? category.name : query ? `Kết quả cho “${query}”` : "Tất cả sản phẩm";
    $("#results-copy").textContent = products.length
      ? `Tìm thấy ${products.length} sản phẩm trong cửa hàng này. Chạm vào sản phẩm để xem đường đi.`
      : "Không tìm thấy sản phẩm phù hợp. Hãy thử tên gọi khác hoặc quét barcode.";
    $("#product-grid").innerHTML = products.length
      ? products.map(productCardMarkup).join("")
      : emptyStateMarkup("Không tìm thấy sản phẩm", "Bạn có thể quay lại và thử từ khóa ngắn hơn.");
    resetSessionTimer();
  }

  function productCardMarkup(product) {
    const current = getProduct(product.id);
    return `
      <button class="product-card" type="button" data-product-id="${product.id}">
        <span class="product-visual">${product.emoji}</span>
        <span class="product-info">
          <small>${escapeHtml(product.category)}</small>
          <strong>${escapeHtml(product.name)}</strong>
          <span class="product-price">${formatCurrency(product.price)}</span>
          <span class="product-location">${icon("pin")} ${escapeHtml(product.aisle)} · ${escapeHtml(product.shelf)} · Còn ${current.shelfQty}</span>
        </span>
      </button>`;
  }

  function scanProduct() {
    openModal(`
      <div class="modal-header"><span class="section-kicker">MÁY QUÉT QUANG HỌC</span><h2>Đưa barcode vào vùng quét</h2><p>Kiosk đang chờ mã sản phẩm…</p></div>
      <div class="modal-body">
        <div class="scan-stage"><span class="scan-code"><strong>8934673574213</strong><small>PRODUCT BARCODE</small></span></div>
        <p class="scan-caption">Đang mô phỏng quét sản phẩm mẫu.</p>
      </div>`, "");
    resetSessionTimer();
    window.setTimeout(() => {
      if ($("#modal-root .scan-stage")) openProductDetail("milk");
    }, 1250);
  }

  function openProductDetail(productId) {
    const product = getProduct(productId);
    if (!product) return;
    const targetClass = product.zone;
    const routes = {
      produce: { path: "M64 277 C75 230 72 174 90 126 S108 68 125 42", x: 125, y: 42 },
      chilled: { path: "M64 277 C108 260 148 252 190 226 S246 180 285 132 S336 68 378 42", x: 378, y: 42 },
      "aisle-a": { path: "M64 277 C58 240 58 205 62 158", x: 62, y: 158 },
      "aisle-b": { path: "M64 277 C92 252 126 234 150 204 S177 175 190 158", x: 190, y: 158 },
      "aisle-c": { path: "M64 277 C110 258 150 250 190 225 S244 184 310 158", x: 310, y: 158 },
      "aisle-d": { path: "M64 277 C125 269 178 263 231 236 S332 184 438 158", x: 438, y: 158 },
    };
    const route = routes[targetClass] || routes["aisle-b"];
    openModal(
      `<div class="product-detail-layout">
        <div class="product-detail-side">
          <div class="large-product-visual">${product.emoji}</div>
          <div>
            <span class="stock-pill">● Còn hàng tại cửa hàng</span>
            <h2>${escapeHtml(product.name)}</h2>
            <div class="detail-price">${formatCurrency(product.price)}</div>
          </div>
        </div>
        <div class="product-map-side">
          <div class="map-heading"><span>ĐƯỜNG ĐI ĐẾN SẢN PHẨM</span><h3>${escapeHtml(product.aisle)} · ${escapeHtml(product.shelf)}</h3><p>Khoảng 1 phút đi bộ từ vị trí kiosk hiện tại.</p></div>
          <div class="store-map" aria-label="Sơ đồ đường đi tới ${escapeHtml(product.name)}">
            <span class="map-zone produce ${targetClass === "produce" ? "is-target" : ""}">RAU CỦ & TRÁI CÂY</span>
            <span class="map-zone chilled ${targetClass === "chilled" ? "is-target" : ""}">SỮA & ĐỒ LẠNH</span>
            <span class="map-zone aisle-a ${targetClass === "aisle-a" ? "is-target" : ""}">DÃY A<br />BÁNH & ĐỒ ĂN NHANH</span>
            <span class="map-zone aisle-b ${targetClass === "aisle-b" ? "is-target" : ""}">DÃY B<br />GIA VỊ</span>
            <span class="map-zone aisle-c ${targetClass === "aisle-c" ? "is-target" : ""}">DÃY C<br />MÌ & THỰC PHẨM KHÔ</span>
            <span class="map-zone aisle-d ${targetClass === "aisle-d" ? "is-target" : ""}">DÃY D<br />CHĂM SÓC NHÀ</span>
            <span class="map-zone entrance">BẠN ĐANG Ở ĐÂY</span>
            <span class="map-zone checkout">QUẦY THANH TOÁN</span>
            <svg class="map-route" viewBox="0 0 500 310" preserveAspectRatio="none" aria-hidden="true">
              <path d="${route.path}" />
              <circle cx="64" cy="277" r="6" />
              <circle cx="${route.x}" cy="${route.y}" r="6" />
            </svg>
          </div>
          <div class="map-legend"><span><i class="you"></i> Kiosk hiện tại</span><span><i class="destination"></i> ${escapeHtml(product.shelf)}</span></div>
          <button class="primary-button full-width" type="button" data-action="close-product">${icon("check")} Tôi đã biết đường</button>
        </div>
      </div>`,
      "is-wide",
    );
    resetSessionTimer();
  }

  function resetKioskHome(resetTimer = true) {
    $("#kiosk-home-view").hidden = false;
    $("#kiosk-results-view").hidden = true;
    $("#product-search").value = "";
    if (resetTimer) resetSessionTimer();
  }

  function startSessionTimer() {
    stopSessionTimer();
    sessionSeconds = 120;
    updateSessionTimer();
    sessionInterval = window.setInterval(() => {
      sessionSeconds -= 1;
      updateSessionTimer();
      if (sessionSeconds <= 0) {
        closeModal();
        resetKioskHome(false);
        sessionSeconds = 120;
        showToast("Phiên kiosk đã đặt lại", "Sẵn sàng phục vụ khách hàng tiếp theo.");
      }
    }, 1000);
  }

  function stopSessionTimer() {
    if (sessionInterval) window.clearInterval(sessionInterval);
    sessionInterval = null;
  }

  function resetSessionTimer() {
    sessionSeconds = 120;
    updateSessionTimer();
  }

  function updateSessionTimer() {
    const timer = $("#session-timer");
    if (!timer) return;
    const minutes = String(Math.floor(sessionSeconds / 60)).padStart(2, "0");
    const seconds = String(sessionSeconds % 60).padStart(2, "0");
    timer.textContent = `${minutes}:${seconds}`;
  }

  function openHelp() {
    openModal(`
      <div class="modal-header"><span class="section-kicker">HƯỚNG DẪN DEMO</span><h2>Hai luồng chính để khám phá</h2><p>Mọi dữ liệu trong prototype là dữ liệu giả lập và chỉ được lưu trên trình duyệt này.</p></div>
      <div class="modal-body">
        <div class="detail-grid">
          <span class="detail-stat"><span>STAFF TASK APP</span><strong>Mô phỏng bán hàng → mở nhiệm vụ → quét ESL → bổ sung kệ.</strong></span>
          <span class="detail-stat"><span>IN-STORE KIOSK</span><strong>Tìm hoặc quét sản phẩm → xem vị trí → đi theo sơ đồ.</strong></span>
        </div>
      </div>
      <div class="modal-footer"><button class="secondary-button" type="button" data-action="reset-demo">Đặt lại dữ liệu demo</button><button class="primary-button" type="button" data-action="close-modal">Đã hiểu</button></div>`);
  }

  function resetDemo() {
    state = clone(initialState);
    saveState();
    closeModal();
    renderStaff();
    resetKioskHome(false);
    showToast("Đã đặt lại dữ liệu", "Tồn kệ và nhiệm vụ đã trở về trạng thái ban đầu.");
  }

  function openModal(content, className = "") {
    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-overlay" data-action="overlay-close">
        <section class="modal-card ${className}" role="dialog" aria-modal="true" aria-label="Chi tiết">
          <button class="modal-close" type="button" data-action="close-modal" aria-label="Đóng">${icon("close")}</button>
          ${content}
        </section>
      </div>`;
    requestAnimationFrame(() => $(".modal-close", root)?.focus());
  }

  function closeModal() {
    const root = $("#modal-root");
    if (root) root.innerHTML = "";
  }

  function showToast(title, copy, type = "success") {
    const region = $("#toast-region");
    const toast = document.createElement("div");
    toast.className = `toast ${type === "warning" ? "is-warning" : ""}`;
    toast.innerHTML = `<span class="toast-icon">${icon(type === "warning" ? "alert" : "check")}</span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></span>`;
    region.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4500);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function initializeDate() {
    const label = $("#today-label");
    if (!label) return;
    const formatted = new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
    label.textContent = formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  document.addEventListener("click", (event) => {
    const actionElement = event.target.closest("[data-action]");
    const taskElement = event.target.closest("[data-task-id]");
    const productElement = event.target.closest("[data-product-id]");
    const categoryElement = event.target.closest("[data-category]");
    const staffTabElement = event.target.closest("[data-staff-tab]");
    const filterElement = event.target.closest("[data-task-filter]");

    if (taskElement) {
      openTask(taskElement.dataset.taskId);
      return;
    }
    if (productElement) {
      openProductDetail(productElement.dataset.productId);
      return;
    }
    if (categoryElement) {
      searchProducts("", categoryElement.dataset.category);
      return;
    }
    if (staffTabElement) {
      switchStaffTab(staffTabElement.dataset.staffTab);
      return;
    }
    if (filterElement) {
      taskFilter = filterElement.dataset.taskFilter;
      $$("[data-task-filter]").forEach((button) => button.classList.toggle("is-active", button === filterElement));
      renderAllTasks();
      return;
    }
    if (!actionElement) return;

    const action = actionElement.dataset.action;
    const actions = {
      "go-home": () => showScreen("mode-screen"),
      "open-staff": () => showScreen("staff-screen"),
      "open-kiosk": () => showScreen("kiosk-screen"),
      "open-help": openHelp,
      "reset-demo": resetDemo,
      "close-modal": closeModal,
      "open-scan": () => openScan(),
      "simulate-sale": simulateSale,
      "scan-task": () => openScan(actionElement.dataset.task),
      "scan-success": () => openRestockForm(actionElement.dataset.task),
      "confirm-restock": () => confirmRestock(actionElement.dataset.task, actionElement.dataset.max),
      "complete-fefo": () => completeFefo(actionElement.dataset.task),
      "scan-product": scanProduct,
      "kiosk-back": () => resetKioskHome(),
      "reset-kiosk": () => resetKioskHome(),
      "close-product": () => {
        closeModal();
        showToast("Chúc bạn mua sắm vui vẻ!", "Kiosk đã ghi nhận bạn xem xong chỉ dẫn.");
      },
      "toggle-language": () => showToast("Ngôn ngữ demo", "Phiên bản MVP hiện sử dụng tiếng Việt."),
      "quantity-down": () => {
        const input = $("#restock-quantity");
        if (input) input.value = Math.max(Number(input.min) || 1, Number(input.value) - 1);
      },
      "quantity-up": () => {
        const input = $("#restock-quantity");
        if (input) input.value = Math.min(Number(input.max) || 99, Number(input.value) + 1);
      },
      "overlay-close": () => {
        if (event.target.classList.contains("modal-overlay")) closeModal();
      },
    };
    actions[action]?.();
  });

  $("#kiosk-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    searchProducts($("#product-search").value);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  document.addEventListener("pointerdown", () => {
    if ($("#kiosk-screen").classList.contains("is-active")) resetSessionTimer();
  });

  initializeDate();
  renderCategories();
  renderStaff();
})();
