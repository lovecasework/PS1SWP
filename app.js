const app = document.querySelector("#app");

const ADMIN_ID = "admin-ps1";
const LEGACY_ADMIN_ID = `admin-${["ps", "wp"].join("")}`;
const LEGACY_ADMIN_NAME = ["PS", "WP"].join("");
const ADMIN_USER = {
  id: ADMIN_ID,
  name: "PS1",
  password: "10041005",
  role: "admin",
  status: "approved",
  studentYear: "",
  createdAt: "2026-05-23T00:00:00.000Z",
};

const STORAGE_KEY = "ps1swp-local-database";
const SESSION_KEY = "ps1swp-current-user";
const CONFIG = window.PS1SWP_CONFIG || {};
const DB_URL = String(CONFIG.databaseURL || "").replace(/\/+$/, "");
const QUERY = new URLSearchParams(window.location.search);
const FORCE_LOCAL = QUERY.get("local") === "1";
const RUN_SMOKE = FORCE_LOCAL && QUERY.get("smoke") === "1";
const USE_REMOTE = !FORCE_LOCAL && CONFIG.useRemoteDatabase !== false && Boolean(DB_URL);
const YEARS = Array.from({ length: 41 }, (_, index) => 2010 + index);
const LEGACY_MY_DRIVE_URL = "https://drive.google.com/drive/my-drive";
const DEFAULT_FILE_SETTINGS = {
  folderName: "실습파일",
  driveUrl: "https://drive.google.com/drive/folders/1Grg6Cmmm0tCQX0op8qO6dMwoToW5lHAQ",
};

const roleLabels = {
  admin: "관리자",
  subadmin: "부관리자",
  student: "실습생",
};

const statusLabels = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "승인 반려",
};

let state = createEmptyState();
let currentUser = null;
let ui = {
  authMode: "login",
  view: "student-apply",
  editingSiteId: "",
  remoteMode: "loading",
  remoteMessage: "데이터 연결 확인 중",
  busy: false,
};

document.addEventListener("DOMContentLoaded", init);
document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);
document.addEventListener("submit", handleSubmit);

async function init() {
  renderLoading();
  await refreshData();
  await ensureAdminUser();
  restoreSession();
  if (RUN_SMOKE) await runLocalSmoke();
  render();
}

function createEmptyState() {
  return {
    users: {},
    sites: {},
    applications: {},
    passwordRequests: {},
    draws: {},
    messages: {},
    fileSubmissions: {},
    settings: {
      fileUpload: { ...DEFAULT_FILE_SETTINGS },
    },
  };
}

async function refreshData() {
  if (USE_REMOTE) {
    try {
      const data = await readRemote("");
      state = normalizeDatabase(data || {});
      writeLocalCache();
      ui.remoteMode = "remote";
      ui.remoteMessage = "Firebase 연결";
      return;
    } catch (error) {
      state = readLocalCache();
      ui.remoteMode = "local";
      ui.remoteMessage = `로컬 임시 저장: ${friendlyError(error)}`;
      return;
    }
  }

  state = readLocalCache();
  ui.remoteMode = "local";
  ui.remoteMessage = "로컬 임시 저장";
}

async function ensureAdminUser() {
  if (state.users[LEGACY_ADMIN_ID] && !state.users[ADMIN_ID]) {
    await saveNode(`users/${ADMIN_ID}`, {
      ...state.users[LEGACY_ADMIN_ID],
      id: ADMIN_ID,
      name: ADMIN_USER.name,
      password: ADMIN_USER.password,
      role: ADMIN_USER.role,
      status: ADMIN_USER.status,
      migratedFrom: LEGACY_ADMIN_ID,
      updatedAt: new Date().toISOString(),
    });
    await deleteNode(`users/${LEGACY_ADMIN_ID}`);
  }

  const admin = state.users[ADMIN_ID];

  if (!admin) {
    await saveNode(`users/${ADMIN_ID}`, ADMIN_USER);
    return;
  }

  if (
    admin.name !== ADMIN_USER.name ||
    admin.password !== ADMIN_USER.password ||
    admin.role !== ADMIN_USER.role ||
    admin.status !== ADMIN_USER.status
  ) {
    await patchNode(`users/${ADMIN_ID}`, {
      name: ADMIN_USER.name,
      password: ADMIN_USER.password,
      role: ADMIN_USER.role,
      status: ADMIN_USER.status,
      updatedAt: new Date().toISOString(),
    });
  }
}

function restoreSession() {
  const id = sessionStorage.getItem(SESSION_KEY);
  currentUser = id ? state.users[id] || null : null;
  if (!currentUser) sessionStorage.removeItem(SESSION_KEY);
}

function renderLoading() {
  app.innerHTML = `
    <main class="loading-screen">
      <img src="./assets/ps1-logo.png" alt="PS1SWP" class="loading-logo" />
      <p>PS1SWP 준비 중</p>
    </main>
  `;
}

function render() {
  syncCurrentUser();

  if (!currentUser) {
    app.innerHTML = renderAuth();
    return;
  }

  if (!isApprovedUser(currentUser)) {
    app.innerHTML = renderApprovalGate();
    return;
  }

  app.innerHTML = renderDashboard();
}

function renderAuth() {
  return `
    <main class="auth-layout">
      <section class="brand-panel">
        <img src="./assets/ps1-logo.png" alt="PS1SWP 로고" class="brand-logo" />
        <div>
          <p class="eyebrow">사회복지현장실습</p>
          <h1 class="program-title">PS1 사회복지현장실습 관리 프로그램</h1>
          <p class="brand-copy">실습 신청부터 승인, 배정, 문서관리까지 한 번에 관리합니다.</p>
        </div>
      </section>

      <section class="auth-card">
        <div class="segmented" role="tablist" aria-label="인증 메뉴">
          ${authTab("login", "로그인")}
          ${authTab("signup", "신규가입")}
          ${authTab("forgot", "비밀번호 찾기")}
        </div>
        ${renderAuthForm()}
      </section>
    </main>
  `;
}

function authTab(mode, label) {
  const active = ui.authMode === mode ? "active" : "";
  return `
    <button class="${active}" type="button" data-action="auth-mode" data-mode="${mode}" role="tab">
      ${label}
    </button>
  `;
}

function renderAuthForm() {
  if (ui.authMode === "signup") {
    return `
      <form class="stack" data-form="signup">
        <div class="form-row">
          <label for="signup-name">이름</label>
          <input id="signup-name" name="name" autocomplete="name" required maxlength="20" />
        </div>
        <div class="form-row">
          <label for="signup-year">학번</label>
          <select id="signup-year" name="studentYear" required>
            <option value="">학번 선택</option>
            ${YEARS.map((year) => `<option value="${year}">${year}학번</option>`).join("")}
          </select>
        </div>
        <div class="notice">비번은 숫자 8자리를 입력하세요.</div>
        <div class="form-row">
          <label for="signup-password">비밀번호</label>
          ${passwordField("signup-password", "password", "숫자 8자리")}
        </div>
        <div class="form-row">
          <label for="signup-confirm">비밀번호 확인</label>
          ${passwordField("signup-confirm", "confirmPassword", "비밀번호 확인")}
        </div>
        <button class="primary-btn" type="submit">가입 신청</button>
      </form>
    `;
  }

  if (ui.authMode === "forgot") {
    return `
      <form class="stack" data-form="forgot">
        <div class="form-row">
          <label for="forgot-name">이름</label>
          <input id="forgot-name" name="name" autocomplete="name" required maxlength="20" />
        </div>
        <div class="form-row">
          <label for="forgot-year">학번</label>
          <select id="forgot-year" name="studentYear" required>
            <option value="">학번 선택</option>
            ${YEARS.map((year) => `<option value="${year}">${year}학번</option>`).join("")}
          </select>
        </div>
        <div class="form-row">
          <label for="forgot-message">메모</label>
          <textarea id="forgot-message" name="message" rows="3" maxlength="80" placeholder="관리자에게 남길 말"></textarea>
        </div>
        <button class="primary-btn" type="submit">관리자에게 요청</button>
      </form>
    `;
  }

  return `
    <form class="stack" data-form="login">
      <div class="form-row">
        <label for="login-name">이름 또는 관리자 ID</label>
        <input id="login-name" name="name" autocomplete="username" required maxlength="20" />
      </div>
      <div class="notice">비밀번호는 8자리 숫자입니다.</div>
      <div class="form-row">
        <label for="login-password">비밀번호</label>
        ${passwordField("login-password", "password", "8자리 숫자")}
      </div>
      <button class="primary-btn" type="submit">입장</button>
    </form>
  `;
}

function passwordField(id, name, placeholder = "") {
  return `
    <div class="password-field">
      <input id="${id}" name="${name}" type="password" inputmode="numeric" autocomplete="current-password" placeholder="${placeholder}" required />
      <button class="icon-btn" type="button" data-action="toggle-password" data-target="${id}" aria-label="비밀번호 보기" title="비밀번호 보기">
        ${eyeIcon()}
      </button>
    </div>
  `;
}

function eyeIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
}

function renderApprovalGate() {
  const isRejected = currentUser.status === "rejected";
  return `
    <main class="approval-screen">
      <section class="auth-card narrow">
        <div class="mini-brand">
          <img src="./assets/ps1-logo.png" alt="PS1SWP" />
          <div>
            <p class="eyebrow">PS1SWP</p>
            <h1>${isRejected ? "승인 반려" : "승인 대기"}</h1>
          </div>
        </div>
        <p class="muted">
          ${escapeHtml(currentUser.name)}님의 가입 상태는 <strong>${statusLabels[currentUser.status] || "확인 중"}</strong>입니다.
        </p>
        <div class="gate-actions">
          <button class="secondary-btn" type="button" data-action="refresh">새로고침</button>
          <button class="ghost-btn" type="button" data-action="logout">로그아웃</button>
        </div>
      </section>
    </main>
  `;
}

function renderDashboard() {
  const navItems = getNavItems();
  if (!navItems.some((item) => item.id === ui.view)) ui.view = navItems[0].id;

  return `
    <div class="dashboard">
      <aside class="sidebar">
        <div class="side-brand">
          <img src="./assets/ps1-logo.png" alt="PS1SWP" />
          <div>
            <strong>PS1SWP</strong>
            <span>사회복지현장실습</span>
          </div>
        </div>
        <nav class="side-nav" aria-label="주요 메뉴">
          ${navItems
            .map(
              (item) => `
                <button class="${ui.view === item.id ? "active" : ""}" type="button" data-action="nav" data-view="${item.id}">
                  <span>${item.icon}</span>${item.label}
                </button>
              `,
            )
            .join("")}
        </nav>
      </aside>

      <main class="main-panel">
        <header class="topbar">
          <div>
            <p class="eyebrow">${roleLabels[currentUser.role] || "사용자"}</p>
            <h1>${escapeHtml(currentUser.name)}</h1>
          </div>
          <div class="top-actions">
            <span class="sync-badge ${ui.remoteMode}">${escapeHtml(ui.remoteMessage)}</span>
            ${isManager() ? `<button class="secondary-btn" type="button" data-action="download-excel">엑셀 다운로드</button>` : ""}
            <button class="secondary-btn" type="button" data-action="refresh">새로고침</button>
            <button class="ghost-btn" type="button" data-action="logout">로그아웃</button>
          </div>
        </header>
        ${window.__PS1SWP_SMOKE_RESULT ? renderSmokeResult() : ""}
        ${renderCurrentView()}
      </main>
    </div>
  `;
}

function renderSmokeResult() {
  const result = window.__PS1SWP_SMOKE_RESULT;
  if (!result.ok) {
    return `<div id="smoke-result" class="smoke-result fail">SMOKE_FAIL ${escapeHtml(result.message)}</div>`;
  }
  return `
    <div id="smoke-result" class="smoke-result">
      SMOKE_PASS users=${result.users} sites=${result.sites} applications=${result.applications} applicationGroups=${result.applicationGroups} draws=${result.draws} messages=${result.messages} files=${result.files} fileSettings=${result.fileSettings} fileWorkflow=${result.fileWorkflow} replyContext=${result.replyContext} replies=${result.replies} publishedDraws=${result.publishedDraws} drawMessageImages=${result.drawMessageImages} uniqueChoices=${result.uniqueChoices}
    </div>
  `;
}

function getNavItems() {
  if (isManager()) {
    return [
      { id: "admin-overview", label: "현황", icon: "▦" },
      { id: "admin-approvals", label: "승인", icon: "✓" },
      { id: "admin-users", label: "사용자", icon: "◎" },
      { id: "admin-sites", label: "실습지", icon: "+" },
      { id: "admin-applications", label: "신청서", icon: "▤" },
      { id: "admin-draws", label: "사다리", icon: "⌘" },
      { id: "messages", label: "쪽지", icon: "✉" },
      { id: "file-submissions", label: "파일", icon: "↗" },
      { id: "password-requests", label: "비번 요청", icon: "?" },
      { id: "change-password", label: "비번 변경", icon: "◐" },
    ];
  }

  return [
    { id: "student-apply", label: "실습 신청", icon: "1" },
    { id: "student-status", label: "내 신청", icon: "2" },
    { id: "messages", label: "쪽지", icon: "✉" },
    { id: "student-files", label: "파일 제출", icon: "↗" },
    { id: "change-password", label: "비번 변경", icon: "◐" },
  ];
}

function renderCurrentView() {
  switch (ui.view) {
    case "admin-overview":
      return renderAdminOverview();
    case "admin-approvals":
      return renderAdminApprovals();
    case "admin-users":
      return renderAdminUsers();
    case "admin-sites":
      return renderAdminSites();
    case "admin-applications":
      return renderAdminApplications();
    case "admin-draws":
      return renderAdminDraws();
    case "messages":
      return renderMessages();
    case "file-submissions":
      return renderFileSubmissions();
    case "student-files":
      return renderStudentFiles();
    case "password-requests":
      return renderPasswordRequests();
    case "student-status":
      return renderStudentStatus();
    case "change-password":
      return renderChangePassword();
    default:
      return renderStudentApply();
  }
}

function renderAdminOverview() {
  const users = userList();
  const pendingUsers = users.filter((user) => user.status === "pending").length;
  const approvedStudents = users.filter((user) => user.status === "approved" && user.role !== "admin").length;
  const subadmins = users.filter((user) => user.role === "subadmin").length;
  const openRequests = passwordRequestList().filter((request) => request.status === "open").length;
  const inboxCount = messageList().filter((message) => message.toId === currentUser.id).length;
  const fileCount = fileSubmissionList().length;

  return `
    <section class="content-grid metrics-grid">
      ${metric("승인 대기", pendingUsers)}
      ${metric("승인 사용자", approvedStudents)}
      ${metric("부관리자", `${subadmins}/3`)}
      ${metric("실습지", siteList().length)}
      ${metric("신청서", applicationList().length)}
      ${metric("비번 요청", openRequests)}
      ${metric("받은 쪽지", inboxCount)}
      ${metric("파일 제출", fileCount)}
    </section>
    <section class="panel export-panel">
      <div>
        <h2>전체 결과 엑셀 다운로드</h2>
        <p>가입자, 비밀번호, 신청 결과, 추첨 결과, 쪽지, 제출 링크와 이메일을 한 파일로 저장합니다.</p>
      </div>
      <button class="primary-btn" type="button" data-action="download-excel">엑셀 다운로드</button>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>최근 사다리 추첨</h2>
        <button class="secondary-btn" type="button" data-action="nav" data-view="admin-draws">열기</button>
      </div>
      ${renderDrawHistory({ compact: true })}
    </section>
  `;
}

function metric(label, value) {
  return `
    <article class="metric-tile">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `;
}

function renderAdminApprovals() {
  const pending = userList().filter((user) => user.status === "pending");
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>가입 승인</h2>
        <span class="count-badge">${pending.length}명</span>
      </div>
      ${
        pending.length
          ? `<div class="table-shell">${pending.map(renderApprovalRow).join("")}</div>`
          : emptyState("승인 대기 중인 가입자가 없습니다.")
      }
    </section>
  `;
}

function renderApprovalRow(user) {
  return `
    <div class="data-row">
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <span>${formatYear(user.studentYear)} · ${formatDate(user.createdAt)}</span>
      </div>
      <div class="row-actions">
        <button class="secondary-btn" type="button" data-action="approve-user" data-id="${user.id}">승인</button>
        <button class="danger-btn" type="button" data-action="reject-user" data-id="${user.id}">반려</button>
      </div>
    </div>
  `;
}

function renderAdminUsers() {
  const users = userList();
  const subadminCount = users.filter((user) => user.role === "subadmin").length;
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>사용자 관리</h2>
        <span class="count-badge">부관리자 ${subadminCount}/3</span>
      </div>
      <div class="table-shell">
        ${users.map((user) => renderUserRow(user, subadminCount)).join("")}
      </div>
    </section>
  `;
}

function renderUserRow(user, subadminCount) {
  const root = isRootAdmin();
  const canPromote = root && user.role === "student" && user.status === "approved" && subadminCount < 3;
  const canDemote = root && user.role === "subadmin";
  const canRemove = root && user.id !== ADMIN_ID;

  return `
    <div class="data-row">
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <span>${formatYear(user.studentYear)} · ${roleLabels[user.role] || "실습생"} · ${statusLabels[user.status] || user.status}</span>
      </div>
      <div class="row-actions">
        ${canPromote ? `<button class="secondary-btn" type="button" data-action="promote-user" data-id="${user.id}">부관리자 지정</button>` : ""}
        ${canDemote ? `<button class="secondary-btn" type="button" data-action="demote-user" data-id="${user.id}">부관리자 해제</button>` : ""}
        ${canRemove ? `<button class="danger-btn" type="button" data-action="remove-user" data-id="${user.id}">강제 탈퇴</button>` : ""}
      </div>
    </div>
  `;
}

function renderAdminSites() {
  const editing = ui.editingSiteId ? state.sites[ui.editingSiteId] : null;
  const sites = siteList();

  return `
    <section class="split-layout">
      <form class="panel stack" data-form="site">
        <div class="panel-head">
          <h2>${editing ? "실습지 수정" : "실습지 입력"}</h2>
          <span class="count-badge">${sites.length}/100</span>
        </div>
        <input type="hidden" name="siteId" value="${editing ? editing.id : ""}" />
        <div class="form-row">
          <label for="site-name">실습지명</label>
          <input id="site-name" name="name" required maxlength="50" value="${escapeAttr(editing?.name || "")}" />
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label for="site-type">유형</label>
            <input id="site-type" name="type" maxlength="30" value="${escapeAttr(editing?.type || "종합복지관")}" />
          </div>
          <div class="form-row">
            <label for="site-capacity">모집인원</label>
            <input id="site-capacity" name="capacity" type="number" min="1" max="99" required value="${editing?.capacity || 1}" />
          </div>
        </div>
        <div class="form-row">
          <label for="site-address">주소</label>
          <input id="site-address" name="address" maxlength="80" value="${escapeAttr(editing?.address || "")}" />
        </div>
        <div class="form-row">
          <label for="site-contact">연락처</label>
          <input id="site-contact" name="contact" maxlength="40" value="${escapeAttr(editing?.contact || "")}" />
        </div>
        <div class="form-row">
          <label for="site-schedule">실습 기간</label>
          <input id="site-schedule" name="schedule" maxlength="80" value="${escapeAttr(editing?.schedule || "")}" />
        </div>
        <div class="form-row">
          <label for="site-memo">안내</label>
          <textarea id="site-memo" name="memo" rows="4" maxlength="260">${escapeHtml(editing?.memo || "")}</textarea>
        </div>
        <div class="form-actions">
          <button class="primary-btn" type="submit">${editing ? "수정 저장" : "실습지 추가"}</button>
          ${editing ? `<button class="ghost-btn" type="button" data-action="cancel-site-edit">취소</button>` : ""}
        </div>
      </form>

      <section class="panel">
        <div class="panel-head">
          <h2>실습지 목록</h2>
          <span class="count-badge">${sites.length}개</span>
        </div>
        ${sites.length ? `<div class="site-list">${sites.map(renderAdminSiteItem).join("")}</div>` : emptyState("등록된 실습지가 없습니다.")}
      </section>
    </section>
  `;
}

function renderAdminSiteItem(site) {
  return `
    <article class="list-item">
      <div>
        <strong>${escapeHtml(site.name)}</strong>
        <span>${escapeHtml(site.type || "기관")} · 모집 ${Number(site.capacity || 1)}명</span>
        <p>${escapeHtml(site.address || site.schedule || "세부 정보 없음")}</p>
      </div>
      <div class="row-actions">
        <button class="secondary-btn" type="button" data-action="edit-site" data-id="${site.id}">수정</button>
        <button class="danger-btn" type="button" data-action="delete-site" data-id="${site.id}">삭제</button>
      </div>
    </article>
  `;
}

function renderAdminApplications() {
  return `
    ${renderApplicationGroupsPanel()}
    <section class="panel">
      <div class="panel-head">
        <h2>최근 사다리 추첨</h2>
        <span class="count-badge">${drawList().length}회</span>
      </div>
      ${renderDrawHistory({ compact: true })}
    </section>
  `;
}

function renderApplicationGroupsPanel() {
  const groups = applicationGroupList();
  const applicantCount = groups.reduce((total, group) => total + group.applications.length, 0);
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>1순위 신청서 목록</h2>
        <span class="count-badge">${groups.length}개 실습지 · ${applicantCount}명</span>
      </div>
      ${
        groups.length
          ? `<div class="application-groups">${groups.map(renderApplicationGroupCard).join("")}</div>`
          : emptyState("아직 1순위로 접수된 신청서가 없습니다.")
      }
    </section>
  `;
}

function renderApplicationGroupCard(group) {
  const { site, applications } = group;
  const winnerMax = Math.max(1, applications.length);
  const defaultWinnerCount = Math.min(Number(site.capacity || 1), winnerMax);
  const inputId = `application-winner-${site.id}`;
  return `
    <article class="application-card">
      <div class="application-card-head">
        <div>
          <strong>${escapeHtml(site.name)}</strong>
          <span>1순위 신청 ${applications.length}명 · 모집 ${Number(site.capacity || 1)}명</span>
        </div>
        <form class="application-draw-form" data-form="draw">
          <input type="hidden" name="siteId" value="${escapeAttr(site.id)}" />
          <input type="hidden" name="priority" value="1" />
          <label for="${escapeAttr(inputId)}">당첨자 수</label>
          <input id="${escapeAttr(inputId)}" name="winnerCount" type="number" min="1" max="${winnerMax}" value="${defaultWinnerCount}" required />
          <button class="primary-btn" type="submit">이 신청서로 사다리 실행</button>
        </form>
      </div>
      <div class="application-table">
        ${applications.map(renderApplicationRow).join("")}
      </div>
    </article>
  `;
}

function renderApplicationRow(item) {
  const { application, user } = item;
  return `
    <div class="application-row">
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <span>${formatYear(user.studentYear || application.studentYear)} · ${formatDateTime(application.updatedAt)}</span>
      </div>
      <div class="choice-pills">
        <span>2순위 ${escapeHtml(siteName(choiceAt(application.choices, 1)) || "-")}</span>
        <span>3순위 ${escapeHtml(siteName(choiceAt(application.choices, 2)) || "-")}</span>
      </div>
    </div>
  `;
}

function renderAdminDraws() {
  const sites = siteList();
  return `
    ${renderApplicationGroupsPanel()}
    <section class="panel">
      <div class="panel-head">
        <h2>직접 사다리 추첨</h2>
        <span class="count-badge">반복 실행 가능</span>
      </div>
      <form class="draw-form" data-form="draw">
        <div class="form-row">
          <label for="draw-site">실습지</label>
          <select id="draw-site" name="siteId" required>
            <option value="">실습지 선택</option>
            ${sites.map((site) => `<option value="${site.id}">${escapeHtml(site.name)} · ${Number(site.capacity || 1)}명</option>`).join("")}
          </select>
        </div>
        <div class="form-row compact">
          <label for="draw-priority">순위</label>
          <select id="draw-priority" name="priority">
            <option value="1">1순위</option>
            <option value="2">2순위</option>
            <option value="3">3순위</option>
          </select>
        </div>
        <div class="form-row compact">
          <label for="draw-winner-count">당첨자 수</label>
          <input id="draw-winner-count" name="winnerCount" type="number" min="1" max="99" value="1" required />
        </div>
        <button class="primary-btn" type="submit">사다리 타기 실행</button>
      </form>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>추첨 기록</h2>
        <span class="count-badge">${drawList().length}회</span>
      </div>
      ${renderDrawHistory()}
    </section>
  `;
}

function renderDrawHistory(options = {}) {
  const draws = drawList().slice(0, options.compact ? 3 : 20);
  if (!draws.length) return emptyState("아직 사다리 추첨 기록이 없습니다.");
  return `
    <div class="draw-history">
      ${draws.map((draw) => renderDrawCard(draw, options.compact)).join("")}
    </div>
  `;
}

function renderDrawCard(draw, compact = false) {
  const winners = draw.results.filter((result) => result.outcome === "선정");
  const delivered = Boolean(draw.publishedAt);
  return `
    <article class="draw-card">
      <div class="draw-head">
        <div>
          <strong>${escapeHtml(draw.siteName)} ${draw.priority}순위</strong>
          <span>${formatDateTime(draw.createdAt)} · ${draw.runNumber || 1}회차 · 신청 ${draw.participants.length}명 · 당첨 ${draw.capacity || winners.length}명${delivered ? " · 전달 완료" : ""}</span>
        </div>
        <div class="row-actions">
          ${isManager() && !delivered ? `<button class="primary-btn small-btn" type="button" data-action="publish-draw" data-id="${draw.id}">결과 인정/전달</button>` : ""}
          <button class="secondary-btn" type="button" data-action="copy-draw" data-id="${draw.id}">문구 복사</button>
          <button class="secondary-btn" type="button" data-action="download-draw" data-id="${draw.id}">결과 이미지</button>
          ${isManager() ? `<button class="danger-btn" type="button" data-action="delete-draw" data-id="${draw.id}">삭제</button>` : ""}
        </div>
      </div>
      <p class="winner-line">선정: ${winners.map((item) => `${escapeHtml(item.name)}(${formatYear(item.studentYear)})`).join(", ") || "없음"}</p>
      ${compact ? "" : renderLadderSvg(draw)}
      ${compact ? "" : renderDrawResultTable(draw)}
    </article>
  `;
}

function renderLadderSvg(draw) {
  const laneCount = Math.max(1, draw.participants.length);
  const width = Math.max(680, laneCount * 92);
  const height = 420;
  const top = 80;
  const bottom = 330;
  const left = 52;
  const gap = laneCount === 1 ? 0 : (width - left * 2) / (laneCount - 1);
  const rowGap = (bottom - top) / Math.max(1, draw.rows);
  const x = (lane) => left + lane * gap;
  const y = (row) => top + (row + 1) * rowGap;

  const verticals = draw.participants
    .map(
      (participant, lane) => `
        <line x1="${x(lane)}" y1="${top}" x2="${x(lane)}" y2="${bottom}" class="ladder-line" />
        <text x="${x(lane)}" y="34" text-anchor="middle" class="ladder-name">${escapeSvg(shortName(participant.name))}</text>
        <text x="${x(lane)}" y="52" text-anchor="middle" class="ladder-year">${escapeSvg(formatYear(participant.studentYear))}</text>
      `,
    )
    .join("");

  const rungs = (draw.rungs || [])
    .map(
      (rung) => `
        <line x1="${x(rung.lane)}" y1="${y(rung.row)}" x2="${x(rung.lane + 1)}" y2="${y(rung.row)}" class="ladder-rung" />
      `,
    )
    .join("");

  const outcomes = (draw.outcomes || [])
    .map(
      (outcome, lane) => `
        <text x="${x(lane)}" y="${bottom + 36}" text-anchor="middle" class="${outcome === "선정" ? "ladder-win" : "ladder-wait"}">${escapeSvg(outcome)}</text>
      `,
    )
    .join("");

  return `
    <div class="ladder-scroll">
      <svg class="ladder-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="사다리 추첨 결과">
        <rect x="0" y="0" width="${width}" height="${height}" rx="8" class="ladder-bg"></rect>
        ${verticals}
        ${rungs}
        ${outcomes}
      </svg>
    </div>
  `;
}

function renderDrawResultTable(draw) {
  const sorted = [...draw.results].sort((a, b) => a.startLane - b.startLane);
  return `
    <div class="mini-table">
      ${sorted
        .map(
          (result) => `
            <div>
              <span>${escapeHtml(result.name)} (${formatYear(result.studentYear)})</span>
              <strong class="${result.outcome === "선정" ? "status-ok" : "status-wait"}">${result.outcome}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderPasswordRequests() {
  const requests = passwordRequestList();
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>비밀번호 찾기 요청</h2>
        <span class="count-badge">${requests.filter((request) => request.status === "open").length}건 대기</span>
      </div>
      ${
        requests.length
          ? `<div class="request-list">${requests.map(renderPasswordRequestItem).join("")}</div>`
          : emptyState("요청이 없습니다.")
      }
    </section>
  `;
}

function renderPasswordRequestItem(request) {
  const matched = findUserForPasswordRequest(request);
  return `
    <article class="list-item request-item">
      <div>
        <strong>${escapeHtml(request.name)} · ${formatYear(request.studentYear)}</strong>
        <span>${request.status === "open" ? "대기" : "처리 완료"} · ${formatDateTime(request.createdAt)}</span>
        <p>${escapeHtml(request.message || "메모 없음")}</p>
        <p class="password-result">
          ${matched ? "가입자 확인 완료 · 비밀번호는 전체 엑셀 다운로드에서 확인하세요." : "일치하는 학생이 없습니다."}
        </p>
      </div>
      <div class="row-actions">
        ${request.status === "open" ? `<button class="secondary-btn" type="button" data-action="resolve-request" data-id="${request.id}">처리 완료</button>` : ""}
        <button class="danger-btn" type="button" data-action="delete-request" data-id="${request.id}">삭제</button>
      </div>
    </article>
  `;
}

function renderMessages() {
  const recipients = messageRecipients();
  const messages = visibleMessageList();

  return `
    <section class="split-layout">
      <form class="panel stack" data-form="message">
        <div class="panel-head">
          <h2>쪽지 보내기</h2>
          <span class="count-badge">${recipients.length}명</span>
        </div>
        <div class="form-row">
          <label for="message-to">받는 사람</label>
          <select id="message-to" name="toId" required ${recipients.length ? "" : "disabled"}>
            <option value="">선택</option>
            ${recipients.map((user) => `<option value="${user.id}">${escapeHtml(user.name)} · ${roleLabels[user.role] || "실습생"}</option>`).join("")}
          </select>
        </div>
        <div class="form-row">
          <label for="message-text">내용</label>
          <textarea id="message-text" name="text" rows="7" maxlength="500" required></textarea>
        </div>
        <button class="primary-btn" type="submit" ${recipients.length ? "" : "disabled"}>쪽지 보내기</button>
      </form>

      <section class="panel">
        <div class="panel-head">
          <h2>쪽지함</h2>
          <span class="count-badge">${messages.length}건</span>
        </div>
        ${messages.length ? `<div class="message-list">${messages.map(renderMessageItem).join("")}</div>` : emptyState("쪽지가 없습니다.")}
      </section>
    </section>
  `;
}

function renderMessageItem(message) {
  const incoming = message.toId === currentUser.id;
  const visibleToCurrentUser = message.toId === currentUser.id || message.fromId === currentUser.id;
  const canReply = incoming && isManager() && message.fromId && message.fromId !== currentUser.id;
  const replyContext = renderMessageReplyContext(message);
  const drawAttachment = renderMessageDrawAttachment(message);
  return `
    <article class="message-item ${incoming ? "incoming" : "outgoing"}">
      <div>
        <strong>${incoming ? `보낸 사람 ${escapeHtml(adminDisplayName(message.fromName))}` : `받는 사람 ${escapeHtml(adminDisplayName(message.toName))}`}</strong>
        <span>${formatDateTime(message.createdAt)}</span>
        ${replyContext}
        <p>${escapeHtml(message.text)}</p>
        ${drawAttachment}
        ${
          canReply
            ? `
              <form class="reply-form" data-form="reply-message">
                <input type="hidden" name="messageId" value="${message.id}" />
                <textarea name="text" rows="3" maxlength="500" required placeholder="답장 내용을 입력하세요"></textarea>
                <button class="secondary-btn" type="submit">답장 보내기</button>
              </form>
            `
            : ""
        }
      </div>
      ${
        visibleToCurrentUser && isManager()
          ? `<button class="danger-btn" type="button" data-action="delete-message" data-id="${message.id}">삭제</button>`
          : ""
      }
    </article>
  `;
}

function renderMessageReplyContext(message) {
  const original = message.replyTo ? state.messages[message.replyTo] : null;
  if (!original) return "";

  const contextLabel =
    original.fromId === currentUser.id
      ? "내가 보낸 쪽지에 대한 답장"
      : `${adminDisplayName(original.fromName)}님이 보낸 쪽지에 대한 답장`;

  return `
    <div class="reply-context">
      <strong>답장 대상: ${escapeHtml(contextLabel)}</strong>
      <span>${formatDateTime(original.createdAt)}</span>
      <p>${escapeHtml(shortName(original.text, 130))}</p>
    </div>
  `;
}

function renderMessageDrawAttachment(message) {
  const draw = message.drawId ? state.draws[message.drawId] : null;
  if (!draw || !draw.publishedAt) return "";

  return `
    <div class="message-draw-attachment">
      <div class="message-draw-head">
        <strong>사다리 결과 그림</strong>
        <span>${escapeHtml(draw.siteName)} ${draw.priority}순위 · ${formatDateTime(draw.createdAt)}</span>
      </div>
      ${renderLadderSvg(draw)}
      <div class="row-actions left">
        <button class="secondary-btn" type="button" data-action="download-draw" data-id="${draw.id}">결과 이미지</button>
      </div>
    </div>
  `;
}

function renderStudentFiles() {
  const submissions = fileSubmissionList().filter((item) => item.userId === currentUser.id);
  const settings = fileUploadSettings();
  const expectedFolderName = expectedStudentDriveFolder(currentUser);

  return `
    <section class="split-layout file-workflow-layout">
      <div class="panel-column">
        <section class="panel stack">
          <div class="panel-head">
            <h2>실습 파일 제출</h2>
            <a class="secondary-btn" href="${escapeAttr(settings.driveUrl)}" target="_blank" rel="noopener">구글 드라이브 폴더로 이동</a>
          </div>
          <div class="file-instruction">
            구글 드라이브 폴더(${escapeHtml(settings.folderName)})에서 자기 이름과 학번으로 폴더를 새로 만들고, 자기 파일을 넣으세요.
            <strong>예: ${escapeHtml(expectedFolderName || "2017_홍길동")}</strong>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>내 제출 정보</h2>
            <span class="count-badge">${submissions.length}건</span>
          </div>
          ${submissions.length ? `<div class="file-list">${submissions.map(renderFileSubmissionItem).join("")}</div>` : emptyState("제출한 링크와 메일주소가 없습니다.")}
        </section>
      </div>

      <form class="panel stack" data-form="file-submission">
        <div class="panel-head">
          <h2>링크와 메일주소 제출</h2>
          <span class="count-badge">관리자 확인용</span>
        </div>
        <div class="notice">실습처 공유링크, 실습 슈퍼바이저 이메일 주소, 필요한 메모를 관리자에게 제공합니다.</div>
        <div class="form-row">
          <label for="practice-link">실습처 공유링크</label>
          <input id="practice-link" name="practiceLink" type="url" placeholder="https://..." />
        </div>
        <div class="form-row">
          <label for="supervisor-email">실습 슈퍼바이저 이메일 주소</label>
          <input id="supervisor-email" name="supervisorEmail" type="email" placeholder="name@example.com" />
        </div>
        <div class="form-row">
          <label for="file-memo">메모</label>
          <textarea id="file-memo" name="memo" rows="4" maxlength="300" placeholder="관리자에게 전달할 내용을 적어주세요."></textarea>
        </div>
        <button class="primary-btn" type="submit">정보 제출</button>
      </form>
    </section>
  `;
}

function renderFileSubmissions() {
  const submissions = fileSubmissionList();
  const settings = fileUploadSettings();

  return `
    <section class="split-layout">
      <form class="panel stack" data-form="file-settings">
        <div class="panel-head">
          <h2>파일 제출 위치</h2>
          <a class="secondary-btn" href="${escapeAttr(settings.driveUrl)}" target="_blank" rel="noopener">현재 위치 열기</a>
        </div>
        <div class="form-row">
          <label for="file-folder-name">폴더 이름</label>
          <input id="file-folder-name" name="folderName" maxlength="60" value="${escapeAttr(settings.folderName)}" required />
        </div>
        <div class="form-row">
          <label for="file-folder-url">Google Drive 폴더 링크</label>
          <input id="file-folder-url" name="driveUrl" type="url" value="${escapeAttr(settings.driveUrl)}" placeholder="https://drive.google.com/drive/folders/..." required />
        </div>
        <button class="primary-btn" type="submit">제출 위치 저장</button>
      </form>
      <section class="panel">
        <div class="panel-head">
          <h2>현재 제출 위치</h2>
          <span class="count-badge">${escapeHtml(settings.folderName)}</span>
        </div>
        <div class="notice">학생 제출 화면의 업로드 버튼이 이 위치로 연결됩니다.</div>
      </section>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>제출 정보 확인</h2>
        <span class="count-badge">${submissions.length}건</span>
      </div>
      ${submissions.length ? `<div class="file-list">${submissions.map(renderFileSubmissionItem).join("")}</div>` : emptyState("제출된 링크와 메일주소가 없습니다.")}
    </section>
  `;
}

function renderFileSubmissionItem(item) {
  const canManage = isManager();
  const practiceLink = submissionPracticeLink(item);
  const expectedFolder = item.expectedFolderName || expectedStudentDriveFolder(item);
  const uploadFolderUrl = item.uploadFolderUrl || "";
  return `
    <article class="list-item file-item">
      <div>
        <strong>${escapeHtml(item.title || "링크와 메일주소 제출")}</strong>
        <span>${escapeHtml(item.userName)} · ${formatYear(item.studentYear)} · ${item.status === "checked" ? "확인 완료" : "미확인"} · ${formatDateTime(item.createdAt)}</span>
        ${expectedFolder ? `<p>학생 Drive 폴더명: <strong>${escapeHtml(expectedFolder)}</strong></p>` : ""}
        ${practiceLink ? `<p>실습처 공유링크: ${escapeHtml(practiceLink)}</p>` : ""}
        ${item.supervisorEmail ? `<p>실습 슈퍼바이저 이메일: ${escapeHtml(item.supervisorEmail)}</p>` : ""}
        ${item.memo ? `<p>메모: ${escapeHtml(item.memo)}</p>` : ""}
      </div>
      <div class="row-actions">
        ${uploadFolderUrl ? `<a class="secondary-btn" href="${escapeAttr(uploadFolderUrl)}" target="_blank" rel="noopener">Drive 폴더</a>` : ""}
        ${practiceLink ? `<a class="secondary-btn" href="${escapeAttr(practiceLink)}" target="_blank" rel="noopener">공유링크</a>` : ""}
        ${item.supervisorEmail ? `<a class="secondary-btn" href="mailto:${escapeAttr(item.supervisorEmail)}">이메일</a>` : ""}
        ${
          canManage && item.status !== "checked"
            ? `<button class="secondary-btn" type="button" data-action="check-file" data-id="${item.id}">확인</button>`
            : ""
        }
        ${canManage ? `<button class="danger-btn" type="button" data-action="delete-file" data-id="${item.id}">삭제</button>` : ""}
      </div>
    </article>
  `;
}

function renderStudentApply() {
  const sites = siteList();
  const application = state.applications[currentUser.id] || {};
  const choiceCount = Math.min(3, sites.length);
  const savedChoices = Array.from({ length: choiceCount }, (_, index) => choiceAt(application.choices, index));
  const seenChoices = new Set();
  const selectedChoices = savedChoices.map((choice) => {
    if (!choice || seenChoices.has(choice)) return "";
    seenChoices.add(choice);
    return choice;
  });

  return `
    <section class="split-layout student-layout">
      <form class="panel stack" data-form="application">
        <div class="panel-head">
          <h2>실습지 3순위 신청</h2>
          <span class="count-badge">${sites.length}개 제공</span>
        </div>
        ${
          choiceCount
            ? Array.from({ length: choiceCount }, (_, index) =>
                renderChoiceSelect(index + 1, selectedChoices[index] || "", sites, selectedChoices),
              ).join("")
            : emptyState("관리자가 실습지를 등록하면 신청할 수 있습니다.")
        }
        <button class="primary-btn" type="submit" ${choiceCount ? "" : "disabled"}>신청 저장</button>
      </form>

      <section class="panel">
        <div class="panel-head">
          <h2>실습지 정보</h2>
          <span class="count-badge">최대 100개</span>
        </div>
        ${sites.length ? `<div class="site-list">${sites.map(renderStudentSiteItem).join("")}</div>` : emptyState("등록된 실습지가 없습니다.")}
      </section>
    </section>
  `;
}

function renderChoiceSelect(priority, selected, sites, selectedChoices = []) {
  return `
    <div class="form-row">
      <label for="choice-${priority}">${priority}순위</label>
      <select id="choice-${priority}" name="priority${priority}" data-choice-select required>
        <option value="">실습지 선택</option>
        ${sites
          .map((site) => {
            const selectedElsewhere = selectedChoices.some((choice, index) => index !== priority - 1 && choice === site.id);
            return `
              <option value="${site.id}" ${selected === site.id ? "selected" : ""} ${selectedElsewhere ? "disabled" : ""}>
                ${escapeHtml(site.name)} · 모집 ${Number(site.capacity || 1)}명${selectedElsewhere ? " · 이미 선택됨" : ""}
              </option>
            `;
          })
          .join("")}
      </select>
    </div>
  `;
}

function renderStudentSiteItem(site) {
  return `
    <article class="list-item">
      <div>
        <strong>${escapeHtml(site.name)}</strong>
        <span>${escapeHtml(site.type || "기관")} · 모집 ${Number(site.capacity || 1)}명</span>
        <p>${escapeHtml([site.address, site.schedule, site.contact].filter(Boolean).join(" · ") || "세부 정보 없음")}</p>
        ${site.memo ? `<p>${escapeHtml(site.memo)}</p>` : ""}
      </div>
    </article>
  `;
}

function renderStudentStatus() {
  const application = state.applications[currentUser.id];
  const relatedDraws = drawList().filter((draw) => draw.publishedAt && draw.participantIds?.includes(currentUser.id));

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>내 신청</h2>
        ${application ? `<span class="count-badge">${formatDateTime(application.updatedAt)}</span>` : ""}
      </div>
      ${
        application
          ? `<div class="choice-summary">${application.choices.map((siteId, index) => renderChoiceSummary(siteId, index)).join("")}</div>`
          : emptyState("저장된 신청이 없습니다.")
      }
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>내 추첨 결과</h2>
        <span class="count-badge">${relatedDraws.length}건</span>
      </div>
      ${
        relatedDraws.length
          ? `<div class="draw-history">${relatedDraws.map((draw) => renderStudentDrawResult(draw)).join("")}</div>`
          : emptyState("아직 관련 추첨 결과가 없습니다.")
      }
    </section>
  `;
}

function renderChoiceSummary(siteId, index) {
  const site = state.sites[siteId];
  return `
    <div class="summary-line">
      <span>${index + 1}순위</span>
      <strong>${escapeHtml(site?.name || "삭제된 실습지")}</strong>
    </div>
  `;
}

function renderStudentDrawResult(draw) {
  const mine = draw.results.find((result) => result.userId === currentUser.id);
  return `
    <article class="draw-card">
      <div class="draw-head">
        <div>
          <strong>${escapeHtml(draw.siteName)} ${draw.priority}순위</strong>
          <span>${formatDateTime(draw.createdAt)} · ${draw.runNumber || 1}회차</span>
        </div>
        <strong class="${mine?.outcome === "선정" ? "status-ok" : "status-wait"}">${mine?.outcome || "확인 중"}</strong>
      </div>
      ${renderLadderSvg(draw)}
      <div class="row-actions left">
        <button class="secondary-btn" type="button" data-action="copy-draw" data-id="${draw.id}">문구 복사</button>
        <button class="secondary-btn" type="button" data-action="download-draw" data-id="${draw.id}">결과 이미지</button>
      </div>
    </article>
  `;
}

function renderChangePassword() {
  return `
    <form class="panel stack narrow-panel" data-form="change-password">
      <div class="panel-head">
        <h2>비밀번호 변경</h2>
      </div>
      <div class="notice">비밀번호는 8자리 숫자입니다.</div>
      <div class="form-row">
        <label for="old-password">기존 비밀번호</label>
        ${passwordField("old-password", "oldPassword", "기존 비밀번호")}
      </div>
      <div class="form-row">
        <label for="new-password">새 비밀번호</label>
        ${passwordField("new-password", "newPassword", "새 비밀번호")}
      </div>
      <div class="form-row">
        <label for="new-password-confirm">새 비밀번호 확인</label>
        ${passwordField("new-password-confirm", "confirmPassword", "새 비밀번호 확인")}
      </div>
      <button class="primary-btn" type="submit">변경 저장</button>
    </form>
  `;
}

function emptyState(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

async function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === "toggle-password") {
    togglePasswordInput(button);
    return;
  }

  if (action === "auth-mode") {
    ui.authMode = button.dataset.mode;
    render();
    return;
  }

  if (action === "nav") {
    ui.view = button.dataset.view;
    render();
    return;
  }

  if (action === "logout") {
    currentUser = null;
    sessionStorage.removeItem(SESSION_KEY);
    ui.view = "student-apply";
    render();
    return;
  }

  if (action === "refresh") {
    renderLoading();
    await refreshData();
    await ensureAdminUser();
    restoreSession();
    render();
    return;
  }

  if (!currentUser) return;

  if (action === "approve-user") await approveUser(id);
  if (action === "reject-user") await rejectUser(id);
  if (action === "promote-user") await promoteUser(id);
  if (action === "demote-user") await demoteUser(id);
  if (action === "remove-user") await removeUser(id);
  if (action === "edit-site") {
    ui.editingSiteId = id;
    render();
    return;
  }
  if (action === "cancel-site-edit") {
    ui.editingSiteId = "";
    render();
    return;
  }
  if (action === "delete-site") await deleteSite(id);
  if (action === "copy-draw") await copyDrawText(id);
  if (action === "download-draw") downloadDrawImage(id);
  if (action === "delete-draw") await deleteDraw(id);
  if (action === "publish-draw") await publishDrawResult(id);
  if (action === "download-excel") downloadExcelWorkbook();
  if (action === "resolve-request") await updatePasswordRequest(id, "resolved");
  if (action === "delete-request") await deletePasswordRequest(id);
  if (action === "delete-message") await deleteMessage(id);
  if (action === "check-file") await updateFileSubmission(id, "checked");
  if (action === "delete-file") await deleteFileSubmission(id);

  render();
}

function handleChange(event) {
  const select = event.target.closest("[data-choice-select]");
  if (!select) return;
  syncUniqueChoiceSelects(select);
}

function syncUniqueChoiceSelects(changedSelect) {
  const form = changedSelect.closest("form[data-form='application']");
  if (!form) return;

  const selects = Array.from(form.querySelectorAll("[data-choice-select]"));
  const seen = new Map();
  for (const select of selects) {
    if (!select.value) continue;
    if (seen.has(select.value)) {
      if (select === changedSelect) {
        seen.get(select.value).value = "";
      } else {
        select.value = "";
      }
    }
    if (select.value) {
      seen.set(select.value, select);
    }
  }

  const selectedValues = selects.map((select) => select.value).filter(Boolean);
  for (const select of selects) {
    for (const option of select.options) {
      if (!option.value) continue;
      option.disabled = selectedValues.includes(option.value) && select.value !== option.value;
      const site = state.sites[option.value];
      if (site) {
        option.textContent = `${site.name} · 모집 ${Number(site.capacity || 1)}명${option.disabled ? " · 이미 선택됨" : ""}`;
      }
    }
  }
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();

  const formType = form.dataset.form;
  const data = Object.fromEntries(new FormData(form).entries());

  try {
    if (formType === "login") await login(data);
    if (formType === "signup") await signup(data);
    if (formType === "forgot") await requestPasswordHelp(data);
    if (formType === "change-password") await changePassword(data);
    if (formType === "site") await saveSite(data);
    if (formType === "application") await saveApplication(data);
    if (formType === "draw") await runDraw(data);
    if (formType === "message") await sendMessage(data);
    if (formType === "reply-message") await replyMessage(data);
    if (formType === "file-submission") await saveFileSubmission(data);
    if (formType === "file-settings") await saveFileSettings(data);
  } catch (error) {
    alert(error.message || "처리 중 문제가 생겼습니다.");
  }

  render();
}

async function login({ name, password }) {
  const cleanName = normalizeName(name);
  const cleanPassword = String(password || "").trim();
  if (!isEightDigitPin(cleanPassword)) throw new Error("비밀번호는 8자리 숫자입니다.");

  const user = userList().find(
    (item) => normalizeName(item.name) === cleanName && String(item.password) === cleanPassword,
  );

  if (!user) throw new Error("이름 또는 비밀번호를 확인해주세요.");

  currentUser = user;
  sessionStorage.setItem(SESSION_KEY, user.id);
  ui.view = isManager(user) ? "admin-overview" : "student-apply";
}

async function signup({ name, studentYear, password, confirmPassword }) {
  const cleanName = String(name || "").trim();
  const cleanYear = String(studentYear || "").trim();
  const cleanPassword = String(password || "").trim();
  const cleanConfirm = String(confirmPassword || "").trim();

  if (!cleanName) throw new Error("이름을 입력해주세요.");
  if (!YEARS.includes(Number(cleanYear))) throw new Error("학번을 선택해주세요.");
  if (!isEightDigitPin(cleanPassword)) throw new Error("비밀번호는 8자리 숫자입니다.");
  if (cleanPassword !== cleanConfirm) throw new Error("비밀번호 확인이 일치하지 않습니다.");

  const duplicated = userList().some((user) => normalizeName(user.name) === normalizeName(cleanName));
  if (duplicated) throw new Error("이미 같은 이름으로 가입된 사용자가 있습니다.");

  const id = createId("user");
  await saveNode(`users/${id}`, {
    id,
    name: cleanName,
    studentYear: cleanYear,
    password: cleanPassword,
    role: "student",
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  ui.authMode = "login";
  alert("가입 신청이 저장되었습니다. 관리자의 승인 후 이용할 수 있습니다.");
}

async function requestPasswordHelp({ name, studentYear, message }) {
  const cleanName = String(name || "").trim();
  const cleanYear = String(studentYear || "").trim();
  if (!cleanName) throw new Error("이름을 입력해주세요.");
  if (!YEARS.includes(Number(cleanYear))) throw new Error("학번을 선택해주세요.");

  const id = createId("request");
  await saveNode(`passwordRequests/${id}`, {
    id,
    name: cleanName,
    studentYear: cleanYear,
    message: String(message || "").trim(),
    status: "open",
    createdAt: new Date().toISOString(),
  });

  ui.authMode = "login";
  alert("요청이 관리자에게 전달되었습니다.");
}

async function changePassword({ oldPassword, newPassword, confirmPassword }) {
  const oldPin = String(oldPassword || "").trim();
  const newPin = String(newPassword || "").trim();
  const confirmPin = String(confirmPassword || "").trim();

  if (String(currentUser.password) !== oldPin) throw new Error("기존 비밀번호가 일치하지 않습니다.");
  if (!isEightDigitPin(newPin)) throw new Error("새 비밀번호는 8자리 숫자입니다.");
  if (newPin !== confirmPin) throw new Error("새 비밀번호 확인이 일치하지 않습니다.");
  if (oldPin === newPin) throw new Error("기존 비밀번호와 다른 번호를 사용해주세요.");

  await patchNode(`users/${currentUser.id}`, {
    password: newPin,
    updatedAt: new Date().toISOString(),
  });

  alert("비밀번호가 변경되었습니다.");
}

async function approveUser(id) {
  requireManager();
  await patchNode(`users/${id}`, {
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvedBy: currentUser.id,
  });
}

async function rejectUser(id) {
  requireManager();
  if (!confirm("이 가입 신청을 반려할까요?")) return;
  await patchNode(`users/${id}`, {
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    rejectedBy: currentUser.id,
  });
}

async function promoteUser(id) {
  requireRootAdmin();
  const subadminCount = userList().filter((user) => user.role === "subadmin").length;
  if (subadminCount >= 3) throw new Error("부관리자는 최대 3명까지 지정할 수 있습니다.");
  await patchNode(`users/${id}`, {
    role: "subadmin",
    promotedAt: new Date().toISOString(),
    promotedBy: currentUser.id,
  });
}

async function demoteUser(id) {
  requireRootAdmin();
  await patchNode(`users/${id}`, {
    role: "student",
    demotedAt: new Date().toISOString(),
    demotedBy: currentUser.id,
  });
}

async function removeUser(id) {
  requireRootAdmin();
  if (id === ADMIN_ID) throw new Error("기본 관리자 계정은 삭제할 수 없습니다.");
  const user = state.users[id];
  if (!user) return;
  if (!confirm(`${user.name}님을 강제 탈퇴시킬까요?`)) return;
  await deleteNode(`users/${id}`);
  await deleteNode(`applications/${id}`);
}

async function saveSite(data) {
  requireManager();
  const id = data.siteId || createId("site");
  const isNew = !data.siteId;
  if (isNew && siteList().length >= 100) throw new Error("실습지는 최대 100개까지 등록할 수 있습니다.");

  const name = String(data.name || "").trim();
  if (!name) throw new Error("실습지명을 입력해주세요.");

  const site = {
    id,
    name,
    type: String(data.type || "").trim(),
    capacity: clampNumber(data.capacity, 1, 99),
    address: String(data.address || "").trim(),
    contact: String(data.contact || "").trim(),
    schedule: String(data.schedule || "").trim(),
    memo: String(data.memo || "").trim(),
    createdAt: state.sites[id]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser.id,
  };

  await saveNode(`sites/${id}`, site);
  ui.editingSiteId = "";
}

async function deleteSite(id) {
  requireManager();
  const site = state.sites[id];
  if (!site) return;
  if (!confirm(`${site.name} 실습지를 삭제할까요?`)) return;
  await deleteNode(`sites/${id}`);
}

async function saveApplication(data) {
  if (!isApprovedUser(currentUser) || isManager(currentUser)) {
    throw new Error("실습생만 신청서를 저장할 수 있습니다.");
  }

  const choices = [data.priority1, data.priority2, data.priority3].filter(Boolean);
  const requiredCount = Math.min(3, siteList().length);
  if (choices.length < requiredCount) throw new Error(`${requiredCount}순위까지 선택해주세요.`);
  if (new Set(choices).size !== choices.length) throw new Error("같은 실습지를 중복 선택할 수 없습니다.");

  await saveNode(`applications/${currentUser.id}`, {
    userId: currentUser.id,
    userName: currentUser.name,
    studentYear: currentUser.studentYear,
    choices,
    updatedAt: new Date().toISOString(),
  });

  alert("신청이 저장되었습니다.");
}

async function runDraw({ siteId, priority, winnerCount }) {
  requireManager();
  const managerId = currentUser.id;
  await refreshData();
  currentUser = state.users[managerId] || currentUser;
  requireManager();

  const site = state.sites[siteId];
  if (!site) throw new Error("실습지를 선택해주세요.");

  const selectedPriority = Number(priority || 1);
  const participants = getDrawParticipants(siteId, selectedPriority);
  if (!participants.length) throw new Error("해당 순위로 신청한 학생이 없습니다.");

  const selectedWinnerCount = clampNumber(winnerCount || site.capacity || 1, 1, participants.length);
  const draw = createDraw(site, selectedPriority, participants, selectedWinnerCount);
  await saveNode(`draws/${draw.id}`, draw);
  ui.view = "admin-draws";
}

function createDraw(site, priority, participants, winnerCount) {
  const id = createId("draw");
  const laneCount = participants.length;
  const rows = laneCount === 1 ? 1 : Math.max(7, Math.min(22, laneCount * 3 + 4));
  const rungs = generateRungs(laneCount, rows);
  const capacity = Math.min(Number(winnerCount || site.capacity || 1), participants.length);
  const outcomes = shuffleArray(
    participants.map((_, index) => (index < capacity ? "선정" : "대기")),
  );
  const results = participants.map((participant, startLane) => {
    const finalLane = traceLadder(startLane, rungs, rows);
    return {
      userId: participant.id,
      name: participant.name,
      studentYear: participant.studentYear,
      startLane,
      finalLane,
      outcome: outcomes[finalLane],
    };
  });

  const runNumber =
    drawList().filter((draw) => draw.siteId === site.id && Number(draw.priority) === Number(priority)).length + 1;

  return {
    id,
    siteId: site.id,
    siteName: site.name,
    priority,
    capacity,
    rows,
    rungs,
    outcomes,
    participants: participants.map((participant, index) => ({
      id: participant.id,
      name: participant.name,
      studentYear: participant.studentYear,
      lane: index,
    })),
    participantIds: participants.map((participant) => participant.id),
    results,
    runNumber,
    createdAt: new Date().toISOString(),
    createdBy: currentUser.id,
    createdByName: currentUser.name,
  };
}

function generateRungs(laneCount, rows) {
  if (laneCount < 2) return [];
  const rungs = [];
  for (let row = 0; row < rows; row += 1) {
    let lane = 0;
    while (lane < laneCount - 1) {
      if (Math.random() < 0.38) {
        rungs.push({ row, lane });
        lane += 2;
      } else {
        lane += 1;
      }
    }
  }
  return rungs;
}

function adminDisplayName(name) {
  return String(name || "") === LEGACY_ADMIN_NAME ? "PS1" : String(name || "");
}

function traceLadder(startLane, rungs, rows) {
  let lane = startLane;
  for (let row = 0; row < rows; row += 1) {
    const right = rungs.find((rung) => rung.row === row && rung.lane === lane);
    if (right) {
      lane += 1;
      continue;
    }
    const left = rungs.find((rung) => rung.row === row && rung.lane === lane - 1);
    if (left) lane -= 1;
  }
  return lane;
}

async function copyDrawText(id) {
  const draw = state.draws[id];
  if (!draw) return;
  const text = buildDrawText(draw);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  alert("추첨 결과 문구를 복사했습니다.");
}

function buildDrawText(draw) {
  const winners = draw.results.filter((result) => result.outcome === "선정");
  const waits = draw.results.filter((result) => result.outcome !== "선정");
  return [
    "[PS1SWP 사다리 추첨 결과]",
    `실습지: ${draw.siteName}`,
    `신청 순위: ${draw.priority}순위`,
    `추첨 일시: ${formatDateTime(draw.createdAt)}`,
    `선정: ${winners.map((item) => `${item.name}(${formatYear(item.studentYear)})`).join(", ") || "없음"}`,
    `대기: ${waits.map((item) => `${item.name}(${formatYear(item.studentYear)})`).join(", ") || "없음"}`,
  ].join("\n");
}

function downloadDrawImage(id) {
  const draw = state.draws[id];
  if (!draw) return;

  const laneCount = Math.max(1, draw.participants.length);
  const width = Math.max(1100, laneCount * 150);
  const height = 760;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  context.fillStyle = "#f8f6ee";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#173f3a";
  context.font = "bold 36px Arial, sans-serif";
  context.fillText("PS1SWP 사다리 추첨 결과", 48, 60);
  context.font = "22px Arial, sans-serif";
  context.fillText(`${draw.siteName} · ${draw.priority}순위 · ${formatDateTime(draw.createdAt)}`, 48, 98);

  const top = 180;
  const bottom = 570;
  const left = 80;
  const gap = laneCount === 1 ? 0 : (width - left * 2) / (laneCount - 1);
  const rowGap = (bottom - top) / Math.max(1, draw.rows);
  const x = (lane) => left + lane * gap;
  const y = (row) => top + (row + 1) * rowGap;

  context.strokeStyle = "#7d8f89";
  context.lineWidth = 4;
  draw.participants.forEach((participant, lane) => {
    context.beginPath();
    context.moveTo(x(lane), top);
    context.lineTo(x(lane), bottom);
    context.stroke();
    context.fillStyle = "#173f3a";
    context.font = "bold 18px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(shortName(participant.name, 8), x(lane), 138);
    context.font = "15px Arial, sans-serif";
    context.fillText(formatYear(participant.studentYear), x(lane), 160);
  });

  context.strokeStyle = "#d86145";
  context.lineWidth = 5;
  (draw.rungs || []).forEach((rung) => {
    context.beginPath();
    context.moveTo(x(rung.lane), y(rung.row));
    context.lineTo(x(rung.lane + 1), y(rung.row));
    context.stroke();
  });

  (draw.outcomes || []).forEach((outcome, lane) => {
    context.fillStyle = outcome === "선정" ? "#d86145" : "#596761";
    context.font = "bold 22px Arial, sans-serif";
    context.fillText(outcome, x(lane), bottom + 48);
  });

  const winners = draw.results.filter((result) => result.outcome === "선정");
  context.textAlign = "left";
  context.fillStyle = "#173f3a";
  context.font = "bold 24px Arial, sans-serif";
  context.fillText(
    `선정: ${winners.map((item) => `${item.name}(${formatYear(item.studentYear)})`).join(", ") || "없음"}`,
    48,
    690,
  );

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `PS1SWP-${safeFileName(draw.siteName)}-${draw.priority}순위-${draw.runNumber || 1}회차.png`;
  link.click();
}

function downloadExcelWorkbook() {
  requireManager();
  const workbook = buildExcelWorkbook();
  const blob = new Blob([workbook], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `PS1SWP-전체결과-${new Date().toISOString().slice(0, 10)}.xls`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function buildExcelWorkbook() {
  const users = userList();
  const sites = siteList();
  const applications = applicationList();
  const draws = drawList();
  const passwordRequests = passwordRequestList();
  const messages = messageList();
  const files = fileSubmissionList();

  const sheets = [
    {
      name: "전체현황",
      rows: [
        ["항목", "값"],
        ["생성일", formatDateTime(new Date().toISOString())],
        ["전체 사용자", users.length],
        ["승인 사용자", users.filter((user) => user.status === "approved").length],
        ["승인 대기", users.filter((user) => user.status === "pending").length],
        ["실습지", sites.length],
        ["신청서", applications.length],
        ["추첨 기록", draws.length],
        ["쪽지", messages.length],
        ["파일 제출", files.length],
      ],
    },
    {
      name: "가입자_비밀번호",
      rows: [
        ["이름", "학번", "역할", "상태", "비밀번호", "가입일", "승인일"],
        ...users.map((user) => [
          user.name,
          formatYear(user.studentYear),
          roleLabels[user.role] || user.role,
          statusLabels[user.status] || user.status,
          user.password || "",
          formatDateTime(user.createdAt),
          formatDateTime(user.approvedAt),
        ]),
      ],
    },
    {
      name: "실습지",
      rows: [
        ["실습지명", "유형", "모집인원", "주소", "연락처", "실습기간", "안내"],
        ...sites.map((site) => [
          site.name,
          site.type || "",
          site.capacity || "",
          site.address || "",
          site.contact || "",
          site.schedule || "",
          site.memo || "",
        ]),
      ],
    },
    {
      name: "신청결과",
      rows: [
        ["이름", "학번", "1순위", "2순위", "3순위", "수정일"],
        ...applications.map((application) => [
          application.userName || state.users[application.userId]?.name || "",
          formatYear(application.studentYear || state.users[application.userId]?.studentYear),
          siteName(application.choices?.[0]),
          siteName(application.choices?.[1]),
          siteName(application.choices?.[2]),
          formatDateTime(application.updatedAt),
        ]),
      ],
    },
    {
      name: "추첨요약",
      rows: [
        ["추첨일", "실습지", "순위", "회차", "당첨자수", "신청자수", "선정자", "대기자"],
        ...draws.map((draw) => [
          formatDateTime(draw.createdAt),
          draw.siteName,
          `${draw.priority}순위`,
          draw.runNumber || "",
          draw.capacity || "",
          draw.participants?.length || "",
          draw.results?.filter((item) => item.outcome === "선정").map((item) => `${item.name}(${formatYear(item.studentYear)})`).join(", ") || "",
          draw.results?.filter((item) => item.outcome !== "선정").map((item) => `${item.name}(${formatYear(item.studentYear)})`).join(", ") || "",
        ]),
      ],
    },
    {
      name: "추첨상세",
      rows: [
        ["추첨일", "실습지", "순위", "회차", "이름", "학번", "결과"],
        ...draws.flatMap((draw) =>
          (draw.results || []).map((result) => [
            formatDateTime(draw.createdAt),
            draw.siteName,
            `${draw.priority}순위`,
            draw.runNumber || "",
            result.name,
            formatYear(result.studentYear),
            result.outcome,
          ]),
        ),
      ],
    },
    {
      name: "비번요청",
      rows: [
        ["요청자", "학번", "상태", "메모", "비밀번호", "요청일", "처리일"],
        ...passwordRequests.map((request) => {
          const matched = findUserForPasswordRequest(request);
          return [
            request.name,
            formatYear(request.studentYear),
            request.status === "open" ? "대기" : "처리 완료",
            request.message || "",
            matched?.password || "",
            formatDateTime(request.createdAt),
            formatDateTime(request.resolvedAt),
          ];
        }),
      ],
    },
    {
      name: "쪽지",
      rows: [
        ["보낸 사람", "받는 사람", "내용", "발송일"],
        ...messages.map((message) => [
          adminDisplayName(message.fromName || ""),
          adminDisplayName(message.toName || ""),
          message.text || "",
          formatDateTime(message.createdAt),
        ]),
      ],
    },
    {
      name: "파일제출",
      rows: [
        ["학생", "학번", "학생 폴더명", "실습처 공유링크", "슈퍼바이저 이메일", "Drive 폴더", "상태", "메모", "제출일", "확인일"],
        ...files.map((file) => [
          file.userName || "",
          formatYear(file.studentYear),
          file.expectedFolderName || expectedStudentDriveFolder(file),
          submissionPracticeLink(file),
          file.supervisorEmail || "",
          file.uploadFolderUrl || "",
          file.status === "checked" ? "확인 완료" : "미확인",
          file.memo || "",
          formatDateTime(file.createdAt),
          formatDateTime(file.checkedAt),
        ]),
      ],
    },
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#6271C9" ss:Pattern="Solid"/></Style>
    <Style ss:ID="text"><NumberFormat ss:Format="@"/></Style>
  </Styles>
  ${sheets.map(worksheetXml).join("")}
</Workbook>`;
}

function worksheetXml(sheet) {
  return `
  <Worksheet ss:Name="${xmlEscape(cleanSheetName(sheet.name))}">
    <Table>
      ${sheet.rows
        .map((row, rowIndex) => `
      <Row>${row.map((cell) => cellXml(cell, rowIndex === 0)).join("")}</Row>`)
        .join("")}
    </Table>
  </Worksheet>`;
}

function cellXml(value, header = false) {
  return `<Cell ss:StyleID="${header ? "header" : "text"}"><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
}

async function deleteDraw(id) {
  requireManager();
  if (!confirm("이 추첨 기록을 삭제할까요?")) return;
  await deleteNode(`draws/${id}`);
}

async function publishDrawResult(id) {
  requireManager();
  const draw = state.draws[id];
  if (!draw) return;
  if (draw.publishedAt) throw new Error("이미 신청자에게 전달된 추첨 결과입니다.");
  if (!confirm("이 사다리 결과를 인정하고 신청자 전원에게 쪽지로 전달할까요?")) return;

  const winners = (draw.results || []).filter((result) => result.outcome === "선정");
  const summary = [
    `[PS1 사다리 추첨 결과]`,
    `실습지: ${draw.siteName}`,
    `신청 순위: ${draw.priority}순위`,
    `추첨 일시: ${formatDateTime(draw.createdAt)}`,
    `선정: ${winners.map((item) => `${item.name}(${formatYear(item.studentYear)})`).join(", ") || "없음"}`,
  ].join("\n");

  for (const result of draw.results || []) {
    const messageId = createId("message");
    await saveNode(`messages/${messageId}`, {
      id: messageId,
      fromId: currentUser.id,
      fromName: adminDisplayName(currentUser.name),
      fromRole: currentUser.role,
      toId: result.userId,
      toName: result.name,
      toRole: "student",
      text: `${summary}\n\n${result.name}님 결과: ${result.outcome}`,
      deletedFor: {},
      drawId: draw.id,
      createdAt: new Date().toISOString(),
    });
  }

  await patchNode(`draws/${id}`, {
    publishedAt: new Date().toISOString(),
    publishedBy: currentUser.id,
    publishedByName: adminDisplayName(currentUser.name),
  });

  alert("사다리 결과를 신청자 전원에게 쪽지로 전달했습니다.");
}

async function runLocalSmoke() {
  const originalAlert = window.alert;
  const originalConfirm = window.confirm;
  window.alert = () => {};
  window.confirm = () => true;

  try {
    localStorage.clear();
    sessionStorage.clear();
    state = createEmptyState();
    currentUser = null;
    ui.authMode = "login";
    ui.view = "student-apply";
    await ensureAdminUser();

    const suffix = Date.now().toString(36);
    const students = [
      { name: `김실습${suffix}`, pin: "12345678", year: "2025" },
      { name: `이실습${suffix}`, pin: "22345678", year: "2025" },
      { name: `박실습${suffix}`, pin: "32345678", year: "2024" },
    ];

    for (const student of students) {
      await signup({
        name: student.name,
        studentYear: student.year,
        password: student.pin,
        confirmPassword: student.pin,
      });
    }

    await login({ name: "PS1", password: "10041005" });
    for (const student of students) {
      const user = userList().find((item) => item.name === student.name);
      await approveUser(user.id);
    }

    const siteNames = [`홀트종합복지관${suffix}`, `남구종합사회복지관${suffix}`, `청소년상담센터${suffix}`];
    await saveSite({
      name: siteNames[0],
      type: "종합복지관",
      capacity: "1",
      address: "부산",
      contact: "",
      schedule: "하계",
      memo: "",
    });
    await saveSite({
      name: siteNames[1],
      type: "종합복지관",
      capacity: "2",
      address: "부산",
      contact: "",
      schedule: "하계",
      memo: "",
    });
    await saveSite({
      name: siteNames[2],
      type: "상담센터",
      capacity: "1",
      address: "부산",
      contact: "",
      schedule: "하계",
      memo: "",
    });

    const sites = siteNames.map((name) => siteList().find((site) => site.name === name));
    for (const student of students) {
      await login({ name: student.name, password: student.pin });
      await saveApplication({
        priority1: sites[0].id,
        priority2: sites[1].id,
        priority3: sites[2].id,
      });
    }

    await login({ name: students[0].name, password: students[0].pin });
    await saveFileSubmission({
      practiceLink: "https://example.com/practice-info",
      supervisorEmail: "supervisor@example.com",
      memo: "테스트 제출",
    });
    await sendMessage({
      toId: ADMIN_ID,
      text: "실습처 링크와 이메일을 제출했습니다.",
    });

    await login({ name: "PS1", password: "10041005" });
    await saveFileSettings({
      folderName: "실습파일",
      driveUrl: DEFAULT_FILE_SETTINGS.driveUrl,
    });
    const incomingMessage = messageList().find((message) => message.toId === ADMIN_ID);
    if (incomingMessage) {
      await replyMessage({
        messageId: incomingMessage.id,
        text: "답장 테스트입니다.",
      });
    }
    const firstStudent = userList().find((user) => user.name === students[0].name);
    await sendMessage({
      toId: firstStudent.id,
      text: "제출 정보를 확인했습니다.",
    });
    await runDraw({ siteId: sites[0].id, priority: "1", winnerCount: "2" });
    const latestDraw = drawList()[0];
    if (latestDraw) await publishDrawResult(latestDraw.id);
    ui.view = "messages";

    window.__PS1SWP_SMOKE_RESULT = {
      ok: true,
      users: userList().length,
      sites: siteList().length,
      applications: applicationList().length,
      applicationGroups: applicationGroupList().length,
      draws: drawList().length,
      messages: messageList().length,
      files: fileSubmissionList().length,
      fileSettings:
        fileUploadSettings().folderName === "실습파일" &&
        fileUploadSettings().driveUrl === DEFAULT_FILE_SETTINGS.driveUrl,
      fileWorkflow: fileSubmissionList().some(
        (file) =>
          file.practiceLink === "https://example.com/practice-info" &&
          file.supervisorEmail === "supervisor@example.com" &&
          file.expectedFolderName === `${students[0].year}_${students[0].name}`,
      ),
      replyContext: messageList().some((message) => message.replyTo && state.messages[message.replyTo]),
      replies: messageList().filter((message) => message.replyTo).length,
      publishedDraws: drawList().filter((draw) => draw.publishedAt).length,
      drawMessageImages: messageList().filter((message) => message.drawId && state.draws[message.drawId]?.publishedAt).length,
      uniqueChoices: applicationList().every((application) => new Set(application.choices || []).size === (application.choices || []).length),
    };
  } catch (error) {
    window.__PS1SWP_SMOKE_RESULT = {
      ok: false,
      message: error.message || String(error),
    };
  } finally {
    window.alert = originalAlert;
    window.confirm = originalConfirm;
  }
}

async function updatePasswordRequest(id, status) {
  requireManager();
  await patchNode(`passwordRequests/${id}`, {
    status,
    resolvedAt: new Date().toISOString(),
    resolvedBy: currentUser.id,
  });
}

async function deletePasswordRequest(id) {
  requireManager();
  if (!confirm("요청을 삭제할까요?")) return;
  await deleteNode(`passwordRequests/${id}`);
}

async function sendMessage({ toId, text }) {
  const toUser = state.users[toId];
  const cleanText = String(text || "").trim();

  if (!toUser || !isApprovedUser(toUser)) throw new Error("받는 사람을 선택해주세요.");
  if (!cleanText) throw new Error("쪽지 내용을 입력해주세요.");
  if (!canSendMessageTo(currentUser, toUser)) {
    throw new Error("쪽지는 관리자와 실습생 사이에서만 보낼 수 있습니다.");
  }

  const id = createId("message");
  await saveNode(`messages/${id}`, {
    id,
    fromId: currentUser.id,
    fromName: adminDisplayName(currentUser.name),
    fromRole: currentUser.role,
    toId: toUser.id,
    toName: adminDisplayName(toUser.name),
    toRole: toUser.role,
    text: cleanText.slice(0, 500),
    deletedFor: {},
    createdAt: new Date().toISOString(),
  });

  alert("쪽지를 보냈습니다.");
}

async function replyMessage({ messageId, text }) {
  requireManager();
  const original = state.messages[messageId];
  if (!original || original.toId !== currentUser.id) {
    throw new Error("받은 쪽지에만 답장할 수 있습니다.");
  }

  const toUser = state.users[original.fromId] || {
    id: original.fromId,
    name: original.fromName || "수신자",
    role: original.fromRole || "student",
    status: "approved",
  };
  const cleanText = String(text || "").trim();
  if (!toUser.id) throw new Error("답장 받을 사용자를 찾을 수 없습니다.");
  if (!cleanText) throw new Error("답장 내용을 입력해주세요.");
  if (!canSendMessageTo(currentUser, toUser)) {
    throw new Error("쪽지는 관리자와 실습생 사이에서만 보낼 수 있습니다.");
  }

  const id = createId("message");
  await saveNode(`messages/${id}`, {
    id,
    fromId: currentUser.id,
    fromName: adminDisplayName(currentUser.name),
    fromRole: currentUser.role,
    toId: toUser.id,
    toName: adminDisplayName(toUser.name),
    toRole: toUser.role,
    text: cleanText.slice(0, 500),
    deletedFor: {},
    replyTo: original.id,
    createdAt: new Date().toISOString(),
  });

  alert("답장을 보냈습니다.");
}

async function deleteMessage(id) {
  requireManager();
  const message = state.messages[id];
  if (!message || (message.toId !== currentUser.id && message.fromId !== currentUser.id)) {
    throw new Error("내가 주고받은 쪽지만 삭제할 수 있습니다.");
  }
  if (!confirm("이 쪽지를 삭제할까요?")) return;
  await patchNode(`messages/${id}`, {
    deletedFor: {
      ...(message.deletedFor || {}),
      [currentUser.id]: true,
    },
  });
}

async function saveFileSubmission({ title, driveUrl, practiceLink, supervisorEmail, memo }) {
  if (!isApprovedUser(currentUser) || isManager(currentUser)) {
    throw new Error("실습생만 링크와 메일주소를 제출할 수 있습니다.");
  }

  const settings = fileUploadSettings();
  const cleanPracticeLink = String(practiceLink || driveUrl || "").trim();
  const cleanEmail = String(supervisorEmail || "").trim();
  const cleanMemo = String(memo || "").trim();
  const expectedFolderName = expectedStudentDriveFolder(currentUser);

  if (!cleanPracticeLink && !cleanEmail && !cleanMemo) {
    throw new Error("실습처 공유링크, 슈퍼바이저 이메일, 메모 중 하나 이상 입력해주세요.");
  }
  if (cleanPracticeLink && !isHttpUrl(cleanPracticeLink)) throw new Error("실습처 공유링크는 https:// 또는 http:// 주소로 입력해주세요.");
  if (cleanEmail && !isEmail(cleanEmail)) throw new Error("이메일 주소 형식을 확인해주세요.");

  const id = createId("file");
  await saveNode(`fileSubmissions/${id}`, {
    id,
    userId: currentUser.id,
    userName: currentUser.name,
    studentYear: currentUser.studentYear,
    title: title ? String(title).trim().slice(0, 60) : `${expectedFolderName} 제출 정보`,
    driveUrl: cleanPracticeLink || settings.driveUrl,
    practiceLink: cleanPracticeLink,
    supervisorEmail: cleanEmail,
    expectedFolderName,
    uploadFolderName: settings.folderName,
    uploadFolderUrl: settings.driveUrl,
    memo: cleanMemo.slice(0, 300),
    status: "submitted",
    createdAt: new Date().toISOString(),
  });

  alert("링크와 메일주소 정보를 제출했습니다.");
}

async function saveFileSettings({ folderName, driveUrl }) {
  requireManager();

  const cleanFolderName = String(folderName || "").trim();
  const cleanUrl = String(driveUrl || "").trim();

  if (!cleanFolderName) throw new Error("폴더 이름을 입력해주세요.");
  if (!isDriveUrl(cleanUrl)) throw new Error("Google Drive 폴더 링크를 입력해주세요.");

  await saveNode("settings/fileUpload", {
    folderName: cleanFolderName.slice(0, 60),
    driveUrl: cleanUrl,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser.id,
  });

  alert("파일 제출 위치가 저장되었습니다.");
}

async function updateFileSubmission(id, status) {
  requireManager();
  await patchNode(`fileSubmissions/${id}`, {
    status,
    checkedAt: new Date().toISOString(),
    checkedBy: currentUser.id,
  });
}

async function deleteFileSubmission(id) {
  requireManager();
  if (!confirm("이 파일 제출 기록을 삭제할까요?")) return;
  await deleteNode(`fileSubmissions/${id}`);
}

function getDrawParticipants(siteId, priority) {
  const users = state.users;
  return applicationList()
    .filter((application) => choiceAt(application.choices, priority - 1) === siteId)
    .map((application) => users[application.userId])
    .filter((user) => user && user.status === "approved" && !isManager(user))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
}

function applicationGroupList() {
  const users = state.users || {};
  return siteList()
    .map((site) => {
      const applications = applicationList()
        .filter((application) => choiceAt(application.choices, 0) === site.id)
        .map((application) => ({
          application,
          user: users[application.userId],
        }))
        .filter(({ user }) => user && user.status === "approved" && !isManager(user))
        .sort((a, b) => String(a.user.name).localeCompare(String(b.user.name), "ko"));

      return { site, applications };
    })
    .filter((group) => group.applications.length)
    .sort((a, b) => String(a.site.name).localeCompare(String(b.site.name), "ko"));
}

function findUserForPasswordRequest(request) {
  return userList().find(
    (user) =>
      normalizeName(user.name) === normalizeName(request.name) &&
      String(user.studentYear || "") === String(request.studentYear || ""),
  );
}

function choiceAt(choices, index) {
  if (Array.isArray(choices)) return choices[index] || "";
  if (choices && typeof choices === "object") return choices[index] || choices[String(index)] || "";
  return "";
}

function userList() {
  return Object.values(state.users || {}).sort((a, b) => {
    if (a.id === ADMIN_ID) return -1;
    if (b.id === ADMIN_ID) return 1;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

function siteList() {
  return Object.values(state.sites || {}).sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
}

function applicationList() {
  return Object.values(state.applications || {}).sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
  );
}

function passwordRequestList() {
  return Object.values(state.passwordRequests || {}).sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
  );
}

function drawList() {
  return Object.values(state.draws || {}).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function messageList() {
  return Object.values(state.messages || {}).sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
  );
}

function visibleMessageList() {
  return messageList().filter(
    (message) =>
      (message.fromId === currentUser.id || message.toId === currentUser.id) &&
      !message.deletedFor?.[currentUser.id],
  );
}

function fileSubmissionList() {
  return Object.values(state.fileSubmissions || {}).sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
  );
}

function fileUploadSettings() {
  return normalizeFileUploadSettings(state.settings?.fileUpload);
}

function normalizeFileUploadSettings(settings) {
  const next = {
    ...DEFAULT_FILE_SETTINGS,
    ...(isPlainObject(settings) ? settings : {}),
  };

  if (!settings?.driveUrl || settings.driveUrl === LEGACY_MY_DRIVE_URL) {
    next.driveUrl = DEFAULT_FILE_SETTINGS.driveUrl;
  }
  if (!settings?.folderName) {
    next.folderName = DEFAULT_FILE_SETTINGS.folderName;
  }

  return next;
}

function expectedStudentDriveFolder(user) {
  const year = String(user?.studentYear || "").trim();
  const name = String(user?.name || user?.userName || "").trim();
  return [year, name]
    .filter(Boolean)
    .join("_")
    .replace(/[\\/:*?"<>|]/g, "_");
}

function submissionPracticeLink(item) {
  if (item.practiceLink) return item.practiceLink;
  if (item.driveUrl && item.driveUrl !== item.uploadFolderUrl) return item.driveUrl;
  return "";
}

function messageRecipients() {
  const users = userList().filter((user) => user.id !== currentUser.id && isApprovedUser(user));
  if (isManager()) {
    return users.filter((user) => user.role === "student");
  }
  return users.filter((user) => user.role === "admin" || user.role === "subadmin");
}

function canSendMessageTo(fromUser, toUser) {
  const fromManager = isManager(fromUser);
  const toManager = isManager(toUser);
  return fromManager !== toManager;
}

function isManager(user = currentUser) {
  return Boolean(user && isApprovedUser(user) && (user.role === "admin" || user.role === "subadmin"));
}

function isRootAdmin(user = currentUser) {
  return Boolean(user && user.id === ADMIN_ID && user.role === "admin");
}

function isApprovedUser(user) {
  return Boolean(user && user.status === "approved");
}

function requireManager() {
  if (!isManager()) throw new Error("관리자 권한이 필요합니다.");
}

function requireRootAdmin() {
  if (!isRootAdmin()) throw new Error("기본 관리자 권한이 필요합니다.");
}

async function saveNode(path, value) {
  setLocalPath(path, value);
  await writeRemoteIfAvailable(path, value, "PUT");
}

async function patchNode(path, value) {
  patchLocalPath(path, value);
  await writeRemoteIfAvailable(path, value, "PATCH");
}

async function deleteNode(path) {
  setLocalPath(path, null);
  await writeRemoteIfAvailable(path, null, "DELETE");
}

async function writeRemoteIfAvailable(path, value, method) {
  writeLocalCache();
  if (ui.remoteMode !== "remote") return;

  try {
    await remoteRequest(path, {
      method,
      body: method === "DELETE" ? undefined : JSON.stringify(value),
    });
  } catch (error) {
    ui.remoteMode = "local";
    ui.remoteMessage = `로컬 임시 저장: ${friendlyError(error)}`;
    writeLocalCache();
  }
}

async function readRemote(path) {
  return remoteRequest(path, { method: "GET" });
}

async function remoteRequest(path, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(`${DB_URL}/${encodePath(path)}.json`, {
      ...options,
      signal: controller.signal,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
    });
    if (!response.ok) throw new Error(`Firebase ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function encodePath(path) {
  if (!path) return "";
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function normalizeDatabase(data) {
  const clean = createEmptyState();
  for (const key of Object.keys(clean)) {
    clean[key] = isPlainObject(data[key]) ? data[key] : {};
  }
  clean.settings = {
    ...clean.settings,
    ...(isPlainObject(data.settings) ? data.settings : {}),
    fileUpload: normalizeFileUploadSettings(data.settings?.fileUpload),
  };
  return clean;
}

function readLocalCache() {
  try {
    return normalizeDatabase(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return createEmptyState();
  }
}

function writeLocalCache() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setLocalPath(path, value) {
  const parts = path.split("/").filter(Boolean);
  const last = parts.pop();
  let target = state;
  for (const part of parts) {
    if (!isPlainObject(target[part])) target[part] = {};
    target = target[part];
  }
  if (value === null) {
    delete target[last];
  } else {
    target[last] = value;
  }
  syncCurrentUser();
  writeLocalCache();
}

function patchLocalPath(path, value) {
  const parts = path.split("/").filter(Boolean);
  const last = parts.pop();
  let target = state;
  for (const part of parts) {
    if (!isPlainObject(target[part])) target[part] = {};
    target = target[part];
  }
  target[last] = { ...(target[last] || {}), ...value };
  syncCurrentUser();
  writeLocalCache();
}

function syncCurrentUser() {
  if (!currentUser) return;
  currentUser = state.users[currentUser.id] || null;
  if (!currentUser) sessionStorage.removeItem(SESSION_KEY);
}

function togglePasswordInput(button) {
  const input = document.getElementById(button.dataset.target);
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  button.setAttribute("aria-label", show ? "비밀번호 숨기기" : "비밀번호 보기");
  button.setAttribute("title", show ? "비밀번호 숨기기" : "비밀번호 보기");
}

function isEightDigitPin(value) {
  return /^\d{8}$/.test(String(value || ""));
}

function isDriveUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && /(^|\.)drive\.google\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("ko-KR");
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (Number.isNaN(number)) return min;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function shuffleArray(items) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatYear(year) {
  return year ? `${year}학번` : "학번 없음";
}

function formatDate(value) {
  if (!value) return "날짜 없음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "날짜 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function shortName(value, max = 7) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function safeFileName(value) {
  return String(value || "result").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
}

function cleanSheetName(value) {
  return String(value || "Sheet")
    .replace(/[\\/?*[\]:]/g, " ")
    .slice(0, 31);
}

function siteName(siteId) {
  return siteId ? state.sites[siteId]?.name || "삭제된 실습지" : "";
}

function friendlyError(error) {
  return String(error?.message || error || "연결 실패").replace(/^TypeError:\s*/i, "");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeSvg(value) {
  return escapeHtml(value);
}
