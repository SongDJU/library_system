/**
 * 도서관 관리자 페이지 JavaScript
 */

// ===========================================
// 전역 변수
// ===========================================
let currentAdmin = null;
let books = [];
let users = [];
let config = {};

// ===========================================
// 초기화
// ===========================================
document.addEventListener('DOMContentLoaded', async () => {
    // SSO 파라미터에서 관리자 정보 추출
    const urlParams = new URLSearchParams(window.location.search);
    const empCode = urlParams.get('emp_code') || urlParams.get('login_id') || '';
    const loginId = urlParams.get('login_id') || '';
    const name = urlParams.get('name') || urlParams.get('login_id') || '관리자';
    
    // 사용자 정보 조회 및 관리자 권한 확인
    try {
        const response = await fetch(`/api/users/me?emp_code=${empCode}&login_id=${loginId}&name=${name}`);
        currentAdmin = await response.json();
        
        if (!currentAdmin.is_admin) {
            // 관리자가 아니면 접근 거부
            document.getElementById('access-denied').classList.remove('hidden');
            document.getElementById('admin-app').classList.add('hidden');
            return;
        }
        
        // 관리자 앱 표시
        document.getElementById('access-denied').classList.add('hidden');
        document.getElementById('admin-app').classList.remove('hidden');
        document.getElementById('admin-name').textContent = currentAdmin.name;
        
        // 데이터 로드
        await loadAllData();
        
        // 이벤트 리스너 설정
        setupEventListeners();
        
        // 대시보드 표시
        updateDashboard();
        
    } catch (error) {
        console.error('초기화 오류:', error);
        showToast('초기화 중 오류가 발생했습니다.', 'error');
    }
});

// ===========================================
// 데이터 로드
// ===========================================
async function loadAllData() {
    await Promise.all([
        loadBooks(),
        loadUsers(),
        loadConfig(),
        loadStats()
    ]);
}

async function loadBooks() {
    try {
        const response = await fetch('/api/books');
        books = await response.json();
        renderBooksTable();
    } catch (error) {
        console.error('도서 로드 실패:', error);
    }
}

async function loadUsers() {
    try {
        const response = await fetch(`/api/admin/users?_admin_code=${currentAdmin.emp_code || currentAdmin.login_id}`);
        users = await response.json();
        renderUsersTable();
    } catch (error) {
        console.error('사용자 로드 실패:', error);
    }
}

async function loadConfig() {
    try {
        const response = await fetch(`/api/admin/config?_admin_code=${currentAdmin.emp_code || currentAdmin.login_id}`);
        config = await response.json();
        fillConfigForm();
    } catch (error) {
        console.error('설정 로드 실패:', error);
    }
}

async function loadStats() {
    try {
        const response = await fetch(`/api/admin/stats?_admin_code=${currentAdmin.emp_code || currentAdmin.login_id}`);
        const stats = await response.json();
        
        document.getElementById('stat-total-books').textContent = stats.total_books;
        document.getElementById('stat-available').textContent = stats.available_books;
        document.getElementById('stat-borrowed').textContent = stats.borrowed_books;
        document.getElementById('stat-overdue').textContent = stats.overdue_count;
        document.getElementById('stat-users').textContent = stats.total_users;
        document.getElementById('stat-reservations').textContent = stats.active_reservations;
        document.getElementById('stat-new-books').textContent = stats.new_books_this_month;
    } catch (error) {
        console.error('통계 로드 실패:', error);
    }
}

async function loadLoans() {
    try {
        const response = await fetch(`/api/admin/loans?_admin_code=${currentAdmin.emp_code || currentAdmin.login_id}`);
        const loans = await response.json();
        renderLoansTable(loans);
    } catch (error) {
        console.error('대출 현황 로드 실패:', error);
    }
}

// ===========================================
// 이벤트 리스너
// ===========================================
function setupEventListeners() {
    // 탭 전환
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    
    // 도서 추가 버튼
    document.getElementById('btn-add-book').addEventListener('click', () => openBookModal());
    
    // 도서 모달
    document.getElementById('book-modal-close').addEventListener('click', closeBookModal);
    document.getElementById('btn-cancel-book').addEventListener('click', closeBookModal);
    document.getElementById('btn-save-book').addEventListener('click', saveBook);
    document.getElementById('edit-search-naver').addEventListener('click', searchNaverForEdit);
    document.querySelector('#book-edit-modal .modal-overlay').addEventListener('click', closeBookModal);
    
    // 사용자 모달
    document.getElementById('user-modal-close').addEventListener('click', closeUserModal);
    document.getElementById('btn-cancel-user').addEventListener('click', closeUserModal);
    document.getElementById('btn-save-user').addEventListener('click', saveUser);
    document.querySelector('#user-edit-modal .modal-overlay').addEventListener('click', closeUserModal);
    
    // 설정 저장
    document.getElementById('save-settings').addEventListener('click', saveSettings);
    
    // 도서 검색
    document.getElementById('admin-book-search').addEventListener('input', debounce(filterBooks, 300));
    
    // 대출 필터
    document.getElementById('loan-filter').addEventListener('change', filterLoans);
}

// ===========================================
// 탭 전환
// ===========================================
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabId}`);
    });
    
    // 탭별 데이터 로드
    if (tabId === 'loans') {
        loadLoans();
    } else if (tabId === 'dashboard') {
        updateDashboard();
    }
}

// ===========================================
// 대시보드
// ===========================================
function updateDashboard() {
    loadStats();
    
    // 연체 도서 목록
    const overdueBooks = books.filter(b => b.is_overdue);
    const overdueList = document.getElementById('overdue-list');
    
    if (overdueBooks.length === 0) {
        overdueList.innerHTML = '<p class="empty-text">연체 도서가 없습니다.</p>';
    } else {
        overdueList.innerHTML = overdueBooks.map(book => `
            <div class="mini-list-item">
                <div>
                    <div class="title">${escapeHtml(book.book_title)}</div>
                    <div class="meta">${escapeHtml(book.applicant)} · ${Math.abs(book.days_left)}일 연체</div>
                </div>
                <span class="badge overdue">연체</span>
            </div>
        `).join('');
    }
    
    // 이달의 신규 도서
    const now = new Date();
    const newBooks = books.filter(b => {
        if (!b.added_date) return false;
        const addedDate = new Date(b.added_date);
        return addedDate.getMonth() === now.getMonth() && addedDate.getFullYear() === now.getFullYear();
    });
    
    const newBooksList = document.getElementById('new-books-list');
    
    if (newBooks.length === 0) {
        newBooksList.innerHTML = '<p class="empty-text">이달의 신규 도서가 없습니다.</p>';
    } else {
        newBooksList.innerHTML = newBooks.slice(0, 5).map(book => `
            <div class="mini-list-item">
                <div>
                    <div class="title">${escapeHtml(book.book_title)}</div>
                    <div class="meta">${escapeHtml(book.publisher || '')} · ${book.added_date}</div>
                </div>
                <span class="badge new">신규</span>
            </div>
        `).join('');
    }
}

// ===========================================
// 도서 관리
// ===========================================
function renderBooksTable(filteredBooks = null) {
    const tbody = document.getElementById('books-table-body');
    const booksToRender = filteredBooks || books;
    
    tbody.innerHTML = booksToRender.map(book => `
        <tr>
            <td>${book.id}</td>
            <td>
                ${book.image_url && !book.image_url.startsWith('/docker')
                    ? `<img src="${book.image_url}" class="book-image" onerror="this.style.display='none'">`
                    : '<div class="book-image" style="display:flex;align-items:center;justify-content:center;background:#f3f4f6;"><i class="ri-book-line" style="color:#9ca3af;"></i></div>'
                }
            </td>
            <td><strong>${escapeHtml(book.book_title)}</strong></td>
            <td>${escapeHtml(book.publisher || '-')}</td>
            <td>${escapeHtml(book.author || '-')}</td>
            <td>
                <span class="status-text ${book.loan_status === '대출 가능' ? 'available' : 'borrowed'}">
                    ${book.loan_status}
                </span>
            </td>
            <td>${book.added_date || '-'}</td>
            <td class="actions">
                <button class="btn-icon edit" onclick="openBookModal(${book.id})" title="수정">
                    <i class="ri-edit-line"></i>
                </button>
                <button class="btn-icon delete" onclick="deleteBook(${book.id})" title="삭제">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function filterBooks() {
    const searchTerm = document.getElementById('admin-book-search').value.toLowerCase();
    
    if (!searchTerm) {
        renderBooksTable();
        return;
    }
    
    const filtered = books.filter(book =>
        book.book_title.toLowerCase().includes(searchTerm) ||
        (book.publisher && book.publisher.toLowerCase().includes(searchTerm)) ||
        (book.author && book.author.toLowerCase().includes(searchTerm))
    );
    
    renderBooksTable(filtered);
}

function openBookModal(bookId = null) {
    const modal = document.getElementById('book-edit-modal');
    const title = document.getElementById('book-modal-title');
    
    if (bookId) {
        const book = books.find(b => b.id === bookId);
        if (!book) return;
        
        title.textContent = '도서 수정';
        document.getElementById('edit-book-id').value = book.id;
        document.getElementById('edit-book-title').value = book.book_title;
        document.getElementById('edit-book-author').value = book.publisher || '';
        document.getElementById('edit-book-publisher').value = book.author || '';
        document.getElementById('edit-book-image').value = book.image_url || '';
        document.getElementById('edit-book-description').value = book.description || '';
    } else {
        title.textContent = '도서 추가';
        document.getElementById('edit-book-id').value = '';
        document.getElementById('edit-book-title').value = '';
        document.getElementById('edit-book-author').value = '';
        document.getElementById('edit-book-publisher').value = '';
        document.getElementById('edit-book-image').value = '';
        document.getElementById('edit-book-description').value = '';
    }
    
    document.getElementById('edit-naver-results').classList.add('hidden');
    modal.classList.remove('hidden');
}

function closeBookModal() {
    document.getElementById('book-edit-modal').classList.add('hidden');
}

async function saveBook() {
    const bookId = document.getElementById('edit-book-id').value;
    const bookData = {
        book_title: document.getElementById('edit-book-title').value.trim(),
        publisher: document.getElementById('edit-book-author').value.trim(),
        author: document.getElementById('edit-book-publisher').value.trim(),
        image_url: document.getElementById('edit-book-image').value.trim(),
        description: document.getElementById('edit-book-description').value.trim(),
        _admin_code: currentAdmin.emp_code || currentAdmin.login_id
    };
    
    if (!bookData.book_title || !bookData.publisher || !bookData.author) {
        showToast('도서명, 저자, 출판사는 필수입니다.', 'warning');
        return;
    }
    
    try {
        let response;
        if (bookId) {
            // 수정
            response = await fetch(`/api/books/${bookId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookData)
            });
        } else {
            // 추가
            response = await fetch('/api/books', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookData)
            });
        }
        
        const result = await response.json();
        
        if (response.ok) {
            showToast(bookId ? '도서가 수정되었습니다.' : '도서가 추가되었습니다.', 'success');
            closeBookModal();
            await loadBooks();
            updateDashboard();
        } else {
            showToast(result.error || '저장 실패', 'error');
        }
    } catch (error) {
        console.error('저장 오류:', error);
        showToast('저장 중 오류가 발생했습니다.', 'error');
    }
}

async function deleteBook(bookId) {
    if (!confirm('정말 이 도서를 삭제하시겠습니까?')) return;
    
    try {
        const response = await fetch(`/api/books/${bookId}?_admin_code=${currentAdmin.emp_code || currentAdmin.login_id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showToast('도서가 삭제되었습니다.', 'success');
            await loadBooks();
            updateDashboard();
        } else {
            const result = await response.json();
            showToast(result.error || '삭제 실패', 'error');
        }
    } catch (error) {
        console.error('삭제 오류:', error);
        showToast('삭제 중 오류가 발생했습니다.', 'error');
    }
}

async function searchNaverForEdit() {
    const title = document.getElementById('edit-book-title').value.trim();
    if (!title) {
        showToast('도서명을 입력해주세요.', 'warning');
        return;
    }
    
    const btn = document.getElementById('edit-search-naver');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span>';
    
    try {
        const response = await fetch(`/api/naver-search?query=${encodeURIComponent(title)}`);
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            displayNaverResultsForEdit(data.items);
        } else {
            showToast('검색 결과가 없습니다.', 'warning');
        }
    } catch (error) {
        showToast('검색 중 오류가 발생했습니다.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="ri-search-line"></i> 네이버 검색';
    }
}

function displayNaverResultsForEdit(items) {
    const resultsDiv = document.getElementById('edit-naver-results');
    const listDiv = document.getElementById('edit-naver-results-list');
    
    window.naverEditResults = items.slice(0, 5);
    
    listDiv.innerHTML = items.slice(0, 5).map((item, index) => `
        <div class="naver-result-item" onclick="selectNaverResultForEdit(${index})">
            <img src="${item.image || ''}" alt="" onerror="this.style.display='none'">
            <div class="naver-result-info">
                <h4>${stripHtml(item.title)}</h4>
                <p>${stripHtml(item.author)} | ${stripHtml(item.publisher)}</p>
            </div>
        </div>
    `).join('');
    
    resultsDiv.classList.remove('hidden');
}

function selectNaverResultForEdit(index) {
    const item = window.naverEditResults[index];
    if (!item) return;
    
    document.getElementById('edit-book-title').value = stripHtml(item.title);
    document.getElementById('edit-book-author').value = stripHtml(item.author);
    document.getElementById('edit-book-publisher').value = stripHtml(item.publisher);
    document.getElementById('edit-book-image').value = item.image || '';
    document.getElementById('edit-book-description').value = stripHtml(item.description || '');
    
    document.getElementById('edit-naver-results').classList.add('hidden');
    showToast('도서 정보가 입력되었습니다.', 'success');
}

// ===========================================
// 사용자 관리
// ===========================================
function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${escapeHtml(user.emp_code || user.login_id)}</td>
            <td><strong>${escapeHtml(user.name)}</strong></td>
            <td>${escapeHtml(user.dept_name || user.dept_code || '-')}</td>
            <td>${user.email || '<span style="color:#9ca3af;">미등록</span>'}</td>
            <td>
                ${user.penalty_until 
                    ? `<span class="status-text overdue">${user.penalty_until}까지</span>`
                    : '<span style="color:#10b981;">-</span>'
                }
            </td>
            <td>${user.is_admin ? '<span style="color:#4f46e5;font-weight:600;">관리자</span>' : '-'}</td>
            <td class="actions">
                <button class="btn-icon edit" onclick="openUserModal('${user.emp_code || user.login_id}')" title="수정">
                    <i class="ri-edit-line"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function openUserModal(empCode) {
    const user = users.find(u => u.emp_code === empCode || u.login_id === empCode);
    if (!user) return;
    
    document.getElementById('edit-user-empcode').value = user.emp_code || user.login_id;
    document.getElementById('edit-user-loginid').value = user.login_id || user.emp_code;
    document.getElementById('edit-user-name').value = user.name || '';
    document.getElementById('edit-user-email').value = user.email || '';
    document.getElementById('edit-user-dept').value = user.dept_name || user.dept_code || '';
    document.getElementById('edit-user-penalty').value = user.penalty_until || '';
    document.getElementById('edit-user-admin').checked = user.is_admin || false;
    
    document.getElementById('user-edit-modal').classList.remove('hidden');
}

function closeUserModal() {
    document.getElementById('user-edit-modal').classList.add('hidden');
}

async function saveUser() {
    const userData = {
        emp_code: document.getElementById('edit-user-empcode').value,
        login_id: document.getElementById('edit-user-loginid').value,
        name: document.getElementById('edit-user-name').value.trim(),
        email: document.getElementById('edit-user-email').value.trim(),
        dept_name: document.getElementById('edit-user-dept').value.trim(),
        penalty_until: document.getElementById('edit-user-penalty').value || null,
        is_admin: document.getElementById('edit-user-admin').checked,
        _admin_code: currentAdmin.emp_code || currentAdmin.login_id
    };
    
    try {
        const response = await fetch('/api/admin/users', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });
        
        if (response.ok) {
            showToast('사용자 정보가 저장되었습니다.', 'success');
            closeUserModal();
            await loadUsers();
            
            // 관리자 코드 목록 업데이트
            if (userData.is_admin && config.admin_codes && !config.admin_codes.includes(userData.emp_code)) {
                config.admin_codes.push(userData.emp_code);
                await saveConfigToServer();
            }
        } else {
            const result = await response.json();
            showToast(result.error || '저장 실패', 'error');
        }
    } catch (error) {
        showToast('저장 중 오류가 발생했습니다.', 'error');
    }
}

// ===========================================
// 대출 현황
// ===========================================
function renderLoansTable(loans) {
    const tbody = document.getElementById('loans-table-body');
    
    if (loans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:3rem;">대출 중인 도서가 없습니다.</td></tr>';
        return;
    }
    
    tbody.innerHTML = loans.map(loan => {
        const statusClass = loan.is_overdue ? 'overdue' : 'normal';
        const daysText = loan.is_overdue 
            ? `${Math.abs(loan.days_left)}일 연체`
            : `${loan.days_left}일 남음`;
        const daysClass = loan.is_overdue ? 'danger' : (loan.days_left <= 3 ? 'warning' : '');
        
        return `
            <tr>
                <td><strong>${escapeHtml(loan.book_title)}</strong></td>
                <td>${escapeHtml(loan.applicant)}</td>
                <td>${loan.application_date}</td>
                <td>${loan.due_date}</td>
                <td>
                    <span class="status-text ${statusClass}">${loan.is_overdue ? '연체' : '정상'}</span>
                    <span class="days-left ${daysClass}">${daysText}</span>
                </td>
                <td class="actions">
                    <button class="btn-icon return" onclick="forceReturn(${loan.id})" title="강제 반납">
                        <i class="ri-arrow-go-back-line"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterLoans() {
    const filter = document.getElementById('loan-filter').value;
    
    fetch(`/api/admin/loans?_admin_code=${currentAdmin.emp_code || currentAdmin.login_id}`)
        .then(res => res.json())
        .then(loans => {
            if (filter === 'overdue') {
                loans = loans.filter(l => l.is_overdue);
            } else if (filter === 'normal') {
                loans = loans.filter(l => !l.is_overdue);
            }
            renderLoansTable(loans);
        });
}

async function forceReturn(bookId) {
    if (!confirm('이 도서를 강제 반납 처리하시겠습니까?')) return;
    
    try {
        const response = await fetch(`/api/books/${bookId}/return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                emp_code: currentAdmin.emp_code || currentAdmin.login_id,
                force: true
            })
        });
        
        if (response.ok) {
            showToast('반납 처리되었습니다.', 'success');
            await loadBooks();
            loadLoans();
            updateDashboard();
        } else {
            const result = await response.json();
            showToast(result.error || '반납 실패', 'error');
        }
    } catch (error) {
        showToast('반납 처리 중 오류가 발생했습니다.', 'error');
    }
}

// ===========================================
// 설정
// ===========================================
function fillConfigForm() {
    if (config.smtp) {
        document.getElementById('smtp-host').value = config.smtp.host || '';
        document.getElementById('smtp-port').value = config.smtp.port || 587;
        document.getElementById('smtp-secure').value = config.smtp.secure ? 'true' : 'false';
        document.getElementById('smtp-user').value = config.smtp.user || '';
        document.getElementById('smtp-password').value = config.smtp.password || '';
        document.getElementById('smtp-from-name').value = config.smtp.from_name || '';
        document.getElementById('smtp-from-email').value = config.smtp.from_email || '';
    }
    
    if (config.admin_codes) {
        document.getElementById('admin-codes').value = config.admin_codes.join(', ');
    }
}

async function saveSettings() {
    config.smtp = {
        host: document.getElementById('smtp-host').value.trim(),
        port: parseInt(document.getElementById('smtp-port').value) || 587,
        secure: document.getElementById('smtp-secure').value === 'true',
        user: document.getElementById('smtp-user').value.trim(),
        password: document.getElementById('smtp-password').value,
        from_name: document.getElementById('smtp-from-name').value.trim(),
        from_email: document.getElementById('smtp-from-email').value.trim()
    };
    
    const adminCodesStr = document.getElementById('admin-codes').value;
    config.admin_codes = adminCodesStr.split(',').map(s => s.trim()).filter(s => s);
    
    await saveConfigToServer();
}

async function saveConfigToServer() {
    try {
        const response = await fetch('/api/admin/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...config,
                _admin_code: currentAdmin.emp_code || currentAdmin.login_id
            })
        });
        
        if (response.ok) {
            showToast('설정이 저장되었습니다.', 'success');
        } else {
            const result = await response.json();
            showToast(result.error || '저장 실패', 'error');
        }
    } catch (error) {
        showToast('저장 중 오류가 발생했습니다.', 'error');
    }
}

// ===========================================
// 유틸리티
// ===========================================
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const icon = toast.querySelector('.toast-icon');
    const messageEl = toast.querySelector('.toast-message');
    
    const icons = {
        success: 'ri-check-line',
        error: 'ri-error-warning-line',
        warning: 'ri-alert-line',
        info: 'ri-information-line'
    };
    
    icon.className = `toast-icon ${icons[type] || icons.info}`;
    messageEl.textContent = message;
    toast.className = `toast ${type}`;
    
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

// 전역 함수로 노출
window.openBookModal = openBookModal;
window.deleteBook = deleteBook;
window.selectNaverResultForEdit = selectNaverResultForEdit;
window.openUserModal = openUserModal;
window.forceReturn = forceReturn;
