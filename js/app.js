/**
 * 사내 도서관 시스템 v2.0
 * SSO 연동 및 도서 관리 애플리케이션
 */

// ===========================================
// SSO 파라미터 설정 (Amaranth10 SSO 연동)
// ===========================================
const SSO_PARAMS = {
    emp_code: 'emp_code',
    login_id: 'login_id',
    dept_code: 'dept_code',
    company_code: 'company_code',
    erp_emp_no: 'erp_emp_no',
    erp_dept_code: 'erp_dept_code',
    erp_company_code: 'erp_company_code',
    email: 'email'  // SSO에서 이메일도 전달
};

// ===========================================
// 전역 상태
// ===========================================
let currentUser = null;
let books = [];
let selectedBook = null;
const LOAN_DURATION_DAYS = 14;

// ===========================================
// 초기화
// ===========================================
document.addEventListener('DOMContentLoaded', async () => {
    const isAuthenticated = await handleSSOAuth();
    
    if (isAuthenticated) {
        document.getElementById('auth-error').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        
        updateUserInfo();
        await loadBooks();
        setupEventListeners();
        renderBookList();
        
        // 관리자 링크 표시
        if (currentUser.is_admin) {
            const adminLink = document.getElementById('admin-link');
            if (adminLink) {
                adminLink.href = `/admin?emp_code=${currentUser.empCode}&login_id=${currentUser.loginId}&name=${encodeURIComponent(currentUser.name)}`;
                adminLink.classList.remove('hidden');
            }
        }
        
        // 패널티 확인
        checkAndShowPenalty();
    } else {
        document.getElementById('auth-error').classList.remove('hidden');
        document.getElementById('app').classList.add('hidden');
    }
});

// ===========================================
// SSO 인증 처리
// ===========================================
async function handleSSOAuth() {
    const urlParams = new URLSearchParams(window.location.search);
    
    const empCode = urlParams.get(SSO_PARAMS.emp_code);
    const loginId = urlParams.get(SSO_PARAMS.login_id);
    const deptCode = urlParams.get(SSO_PARAMS.dept_code);
    const companyCode = urlParams.get(SSO_PARAMS.company_code);
    const email = urlParams.get(SSO_PARAMS.email);  // SSO에서 이메일 받기
    const name = urlParams.get('name');
    
    // 개발 모드
    if (!loginId && !empCode) {
        console.log('[DEV MODE] SSO 파라미터 없음 - 테스트 사용자 사용');
        currentUser = {
            empCode: 'TEST001',
            loginId: 'test_user',
            name: '테스트 사용자',
            email: '',
            deptCode: 'DEV',
            deptName: '개발팀',
            companyCode: 'CORP',
            is_admin: false,
            penalty: { isPenalized: false }
        };
    } else {
        currentUser = {
            empCode: empCode || '',
            loginId: loginId || '',
            name: name || loginId || empCode || '사용자',
            email: email || '',  // SSO 이메일 저장
            deptCode: deptCode || '',
            deptName: getDeptName(deptCode),
            companyCode: companyCode || ''
        };
    }
    
    // 서버에서 사용자 정보 조회/생성 (SSO 이메일 포함)
    try {
        const response = await fetch(`/api/users/me?emp_code=${currentUser.empCode}&login_id=${currentUser.loginId}&name=${encodeURIComponent(currentUser.name)}&dept_code=${currentUser.deptCode}&dept_name=${encodeURIComponent(currentUser.deptName)}&email=${encodeURIComponent(currentUser.email)}`);
        const userData = await response.json();
        
        currentUser = {
            ...currentUser,
            // SSO 이메일이 있으면 우선 사용, 없으면 DB 저장된 이메일
            email: currentUser.email || userData.email || '',
            is_admin: userData.is_admin || false,
            penalty: userData.penalty || { isPenalized: false }
        };
    } catch (error) {
        console.error('사용자 정보 조회 실패:', error);
    }
    
    return true;
}

function getDeptName(deptCode) {
    const deptMap = {
        'DEV': '개발팀',
        'HR': '인사팀',
        'FIN': '재무팀',
        'MKT': '마케팅팀',
        'SALES': '영업팀',
        'ADMIN': '관리팀'
    };
    return deptMap[deptCode] || deptCode || '';
}

function updateUserInfo() {
    document.getElementById('user-name').textContent = currentUser.name;
    document.getElementById('user-dept').textContent = currentUser.deptName;
    
    // 내 정보 탭
    document.getElementById('info-name').textContent = currentUser.name;
    document.getElementById('info-empcode').textContent = currentUser.empCode || currentUser.loginId;
    document.getElementById('info-dept').textContent = currentUser.deptName || '-';
    document.getElementById('info-email').value = currentUser.email || '';
}

function checkAndShowPenalty() {
    if (currentUser.penalty && currentUser.penalty.isPenalized) {
        const banner = document.getElementById('penalty-banner');
        const message = document.getElementById('penalty-message');
        message.textContent = `연체로 인해 ${currentUser.penalty.until}까지 대출이 제한됩니다. (${currentUser.penalty.daysLeft}일 남음)`;
        banner.classList.remove('hidden');
        
        document.getElementById('info-penalty').innerHTML = `<span style="color:#ef4444;">${currentUser.penalty.until}까지 제한</span>`;
    } else {
        document.getElementById('info-penalty').textContent = '없음';
    }
}

// ===========================================
// 도서 데이터 관리
// ===========================================
async function loadBooks() {
    try {
        const response = await fetch('/api/books');
        books = await response.json();
        console.log(`[INFO] ${books.length}권의 도서 로드 완료`);
    } catch (error) {
        console.error('[ERROR] 도서 데이터 로드 실패:', error);
        showToast('도서 데이터를 불러오는데 실패했습니다.', 'error');
    }
}

// ===========================================
// 이벤트 리스너 설정
// ===========================================
function setupEventListeners() {
    // 탭 전환
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    
    // 검색
    document.getElementById('search-input').addEventListener('input', debounce(handleSearch, 300));
    document.getElementById('status-filter').addEventListener('change', handleSearch);
    
    // 모달
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.querySelector('.modal-overlay').addEventListener('click', closeModal);
    
    // 대출/반납/예약
    document.getElementById('btn-borrow').addEventListener('click', handleBorrow);
    document.getElementById('btn-return').addEventListener('click', handleReturn);
    document.getElementById('btn-reserve').addEventListener('click', handleReserve);
    
    // 내 정보 저장
    document.getElementById('save-my-info').addEventListener('click', saveMyInfo);
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
    switch (tabId) {
        case 'my-loans':
            renderMyLoans();
            break;
        case 'my-reservations':
            renderMyReservations();
            break;
        case 'new-books':
            renderNewBooks();
            break;
    }
}

// ===========================================
// 도서 목록 렌더링
// ===========================================
function renderBookList(filteredBooks = null) {
    const bookList = document.getElementById('book-list');
    const booksToRender = filteredBooks || books;
    
    const availableCount = books.filter(b => b.loan_status === '대출 가능').length;
    document.getElementById('total-count').textContent = `전체 ${books.length}권`;
    document.getElementById('available-count').textContent = `대출 가능 ${availableCount}권`;
    
    if (booksToRender.length === 0) {
        bookList.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <i class="ri-book-line"></i>
                <p>검색 결과가 없습니다.</p>
            </div>
        `;
        return;
    }
    
    bookList.innerHTML = booksToRender.map(book => createBookCard(book)).join('');
}

function createBookCard(book) {
    const isOverdue = book.is_overdue;
    const statusClass = book.loan_status === '대출 가능' ? 'available' : (isOverdue ? 'overdue' : 'borrowed');
    const statusText = isOverdue ? '연체 중' : book.loan_status;
    
    return `
        <div class="book-card" data-id="${book.id}" onclick="openBookModal(${book.id})">
            <div class="book-card-image">
                ${book.image_url && !book.image_url.startsWith('/docker')
                    ? `<img src="${book.image_url}" alt="${book.book_title}" onerror="this.parentElement.innerHTML='<div class=\\'placeholder-image\\'><i class=\\'ri-book-line\\'></i></div>'">`
                    : `<div class="placeholder-image"><i class="ri-book-line"></i></div>`
                }
            </div>
            <div class="book-card-info">
                <h3 class="book-card-title">${escapeHtml(book.book_title)}</h3>
                <p class="book-card-author">${escapeHtml(book.publisher || '저자 미상')}</p>
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
        </div>
    `;
}

// ===========================================
// 이달의 신규 도서
// ===========================================
function renderNewBooks() {
    const now = new Date();
    const newBooks = books.filter(b => {
        if (!b.added_date) return false;
        const addedDate = new Date(b.added_date);
        return addedDate.getMonth() === now.getMonth() && addedDate.getFullYear() === now.getFullYear();
    });
    
    const container = document.getElementById('new-books-list');
    
    if (newBooks.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <i class="ri-sparkling-line"></i>
                <p>이번 달에 등록된 신규 도서가 없습니다.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = newBooks.map(book => createBookCard(book)).join('');
}

// ===========================================
// 검색 및 필터
// ===========================================
function handleSearch() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    const statusFilter = document.getElementById('status-filter').value;
    
    let filtered = books;
    
    if (searchTerm) {
        filtered = filtered.filter(book =>
            book.book_title.toLowerCase().includes(searchTerm) ||
            (book.publisher && book.publisher.toLowerCase().includes(searchTerm)) ||
            (book.author && book.author.toLowerCase().includes(searchTerm))
        );
    }
    
    if (statusFilter !== 'all') {
        if (statusFilter === 'available') {
            filtered = filtered.filter(book => book.loan_status === '대출 가능');
        } else if (statusFilter === 'borrowed') {
            filtered = filtered.filter(book => book.loan_status === '대출 중');
        }
    }
    
    renderBookList(filtered);
}

// ===========================================
// 모달
// ===========================================
function openBookModal(bookId) {
    selectedBook = books.find(b => b.id === bookId);
    if (!selectedBook) return;
    
    const modal = document.getElementById('book-modal');
    
    // 이미지
    const imageEl = document.getElementById('modal-image');
    if (selectedBook.image_url && !selectedBook.image_url.startsWith('/docker')) {
        imageEl.src = selectedBook.image_url;
        imageEl.onerror = () => imageEl.style.display = 'none';
        imageEl.style.display = 'block';
    } else {
        imageEl.style.display = 'none';
    }
    
    // 기본 정보
    document.getElementById('modal-title').textContent = selectedBook.book_title;
    document.getElementById('modal-author').textContent = selectedBook.publisher || '저자 미상';
    document.getElementById('modal-publisher').textContent = selectedBook.author || '출판사 미상';
    
    // 상태
    const isOverdue = selectedBook.is_overdue;
    const statusClass = selectedBook.loan_status === '대출 가능' ? 'available' : (isOverdue ? 'overdue' : 'borrowed');
    const statusText = isOverdue ? '연체 중' : selectedBook.loan_status;
    
    const statusEl = document.getElementById('modal-status');
    statusEl.textContent = statusText;
    statusEl.className = `status-badge ${statusClass}`;
    
    // 반납 예정일 정보
    const dueInfo = document.getElementById('modal-due-info');
    if (selectedBook.loan_status === '대출 중' && selectedBook.due_date) {
        document.getElementById('modal-due-date').textContent = selectedBook.due_date;
        const daysLeftEl = document.getElementById('modal-days-left');
        
        if (selectedBook.days_left < 0) {
            daysLeftEl.innerHTML = `<span style="color:#ef4444;font-weight:600;">${Math.abs(selectedBook.days_left)}일 연체</span>`;
        } else if (selectedBook.days_left <= 3) {
            daysLeftEl.innerHTML = `<span style="color:#f59e0b;">${selectedBook.days_left}일 남음</span>`;
        } else {
            daysLeftEl.innerHTML = `<span style="color:#10b981;">${selectedBook.days_left}일 남음</span>`;
        }
        dueInfo.classList.remove('hidden');
    } else {
        dueInfo.classList.add('hidden');
    }
    
    // 대출자 정보
    const applicantInfo = document.getElementById('modal-applicant-info');
    if (selectedBook.loan_status === '대출 중' && selectedBook.applicant) {
        document.getElementById('modal-applicant').textContent = selectedBook.applicant;
        document.getElementById('modal-loan-date').textContent = selectedBook.application_date || '-';
        applicantInfo.classList.remove('hidden');
    } else {
        applicantInfo.classList.add('hidden');
    }
    
    // 예약 정보 (간략하게)
    document.getElementById('modal-reservation-info').classList.add('hidden');
    
    // 버튼 상태
    const btnBorrow = document.getElementById('btn-borrow');
    const btnReturn = document.getElementById('btn-return');
    const btnReserve = document.getElementById('btn-reserve');
    
    const isMyBook = selectedBook.applicant === currentUser.name ||
                     selectedBook.applicant === currentUser.loginId ||
                     selectedBook.applicant === currentUser.empCode;
    
    if (selectedBook.loan_status === '대출 가능') {
        btnBorrow.classList.remove('hidden');
        btnReturn.classList.add('hidden');
        btnReserve.classList.add('hidden');
        
        // 패널티 체크
        if (currentUser.penalty && currentUser.penalty.isPenalized) {
            btnBorrow.disabled = true;
            btnBorrow.innerHTML = '<i class="ri-lock-line"></i> 대출 제한 중';
        } else {
            btnBorrow.disabled = false;
            btnBorrow.innerHTML = '<i class="ri-book-read-line"></i> 대출하기';
        }
    } else if (selectedBook.loan_status === '대출 중') {
        if (isMyBook) {
            btnBorrow.classList.add('hidden');
            btnReturn.classList.remove('hidden');
            btnReserve.classList.add('hidden');
        } else {
            btnBorrow.classList.add('hidden');
            btnReturn.classList.add('hidden');
            btnReserve.classList.remove('hidden');
        }
    } else {
        btnBorrow.classList.add('hidden');
        btnReturn.classList.add('hidden');
        btnReserve.classList.add('hidden');
    }
    
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('book-modal').classList.add('hidden');
    selectedBook = null;
}

// ===========================================
// 대출/반납/예약 처리
// ===========================================
async function handleBorrow() {
    if (!selectedBook) return;
    
    // 패널티 체크
    if (currentUser.penalty && currentUser.penalty.isPenalized) {
        showToast('대출 제한 중입니다.', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`/api/books/${selectedBook.id}/borrow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                applicant: currentUser.name,
                emp_code: currentUser.empCode || currentUser.loginId
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast(`"${selectedBook.book_title}" 대출 완료! 반납예정일: ${result.due_date}`, 'success');
            closeModal();
            await loadBooks();
            renderBookList();
        } else {
            showToast(result.error || '대출 처리 실패', 'error');
        }
    } catch (error) {
        console.error('대출 오류:', error);
        showToast('대출 처리 중 오류가 발생했습니다.', 'error');
    }
}

async function handleReturn() {
    if (!selectedBook) return;
    
    try {
        const response = await fetch(`/api/books/${selectedBook.id}/return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                emp_code: currentUser.empCode || currentUser.loginId
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            if (result.penalty) {
                showToast(`반납 완료. 연체 ${result.overdue_days}일로 ${result.penalty.penaltyDays}일간 대출이 제한됩니다.`, 'warning');
                currentUser.penalty = { isPenalized: true, until: result.penalty.penaltyUntil, daysLeft: result.penalty.penaltyDays };
                checkAndShowPenalty();
            } else {
                showToast(`"${selectedBook.book_title}" 반납이 완료되었습니다.`, 'success');
            }
            closeModal();
            await loadBooks();
            renderBookList();
            renderMyLoans();
        } else {
            showToast(result.error || '반납 처리 실패', 'error');
        }
    } catch (error) {
        console.error('반납 오류:', error);
        showToast('반납 처리 중 오류가 발생했습니다.', 'error');
    }
}

async function handleReserve() {
    if (!selectedBook) return;
    
    try {
        const response = await fetch(`/api/books/${selectedBook.id}/reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                emp_code: currentUser.empCode || currentUser.loginId,
                name: currentUser.name
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast(`"${selectedBook.book_title}" 예약이 완료되었습니다. 반납 시 알림을 받습니다.`, 'success');
            closeModal();
        } else {
            showToast(result.error || '예약 실패', 'error');
        }
    } catch (error) {
        console.error('예약 오류:', error);
        showToast('예약 처리 중 오류가 발생했습니다.', 'error');
    }
}

// ===========================================
// 내 대출 목록
// ===========================================
function renderMyLoans() {
    const loansList = document.getElementById('my-loans-list');
    const myBooks = books.filter(book =>
        book.applicant === currentUser.name ||
        book.applicant === currentUser.loginId ||
        book.applicant === currentUser.empCode
    );
    
    if (myBooks.length === 0) {
        loansList.innerHTML = `
            <div class="empty-state">
                <i class="ri-book-open-line"></i>
                <p>대출 중인 도서가 없습니다.</p>
            </div>
        `;
        return;
    }
    
    loansList.innerHTML = myBooks.map(book => {
        const isOverdue = book.is_overdue;
        const daysText = isOverdue
            ? `<span style="color:#ef4444;font-weight:600;">${Math.abs(book.days_left)}일 연체</span>`
            : `<span style="color:${book.days_left <= 3 ? '#f59e0b' : '#10b981'};">${book.days_left}일 남음</span>`;
        
        return `
            <div class="loan-item">
                ${book.image_url && !book.image_url.startsWith('/docker')
                    ? `<img src="${book.image_url}" alt="${book.book_title}" class="loan-item-image" onerror="this.src=''">`
                    : `<div class="loan-item-image placeholder-image"><i class="ri-book-line"></i></div>`
                }
                <div class="loan-item-info">
                    <h4 class="loan-item-title">${escapeHtml(book.book_title)}</h4>
                    <p class="loan-item-meta">${escapeHtml(book.publisher || '')} | ${escapeHtml(book.author || '')}</p>
                    <p class="loan-item-meta">대출일: ${book.application_date || '-'} · 반납예정: ${book.due_date || '-'}</p>
                    <p class="loan-item-meta">${daysText}</p>
                </div>
                <div class="loan-item-actions">
                    <button class="btn btn-success" onclick="returnBook(${book.id})">
                        <i class="ri-arrow-go-back-line"></i>
                        반납
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function returnBook(bookId) {
    const book = books.find(b => b.id === bookId);
    if (!book) return;
    
    try {
        const response = await fetch(`/api/books/${bookId}/return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                emp_code: currentUser.empCode || currentUser.loginId
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            if (result.penalty) {
                showToast(`반납 완료. 연체 ${result.overdue_days}일로 ${result.penalty.penaltyDays}일간 대출이 제한됩니다.`, 'warning');
                currentUser.penalty = { isPenalized: true, until: result.penalty.penaltyUntil, daysLeft: result.penalty.penaltyDays };
                checkAndShowPenalty();
            } else {
                showToast(`"${book.book_title}" 반납이 완료되었습니다.`, 'success');
            }
            await loadBooks();
            renderBookList();
            renderMyLoans();
        } else {
            showToast(result.error || '반납 처리 실패', 'error');
        }
    } catch (error) {
        showToast('반납 처리 중 오류가 발생했습니다.', 'error');
    }
}

// ===========================================
// 내 예약 목록
// ===========================================
async function renderMyReservations() {
    const container = document.getElementById('my-reservations-list');
    
    try {
        const response = await fetch(`/api/reservations/my?emp_code=${currentUser.empCode || currentUser.loginId}`);
        const reservations = await response.json();
        
        if (reservations.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="ri-calendar-line"></i>
                    <p>예약 중인 도서가 없습니다.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = reservations.map(res => {
            const book = books.find(b => b.id === res.book_id);
            return `
                <div class="loan-item">
                    ${book && book.image_url && !book.image_url.startsWith('/docker')
                        ? `<img src="${book.image_url}" alt="" class="loan-item-image" onerror="this.src=''">`
                        : `<div class="loan-item-image placeholder-image"><i class="ri-book-line"></i></div>`
                    }
                    <div class="loan-item-info">
                        <h4 class="loan-item-title">${escapeHtml(book?.book_title || '도서명 없음')}</h4>
                        <p class="loan-item-meta">예약일: ${res.reserved_at}</p>
                        <p class="loan-item-meta"><span class="status-badge reserved">예약 대기중</span></p>
                    </div>
                    <div class="loan-item-actions">
                        <button class="btn btn-secondary" onclick="cancelReservation(${res.id})">
                            <i class="ri-close-line"></i>
                            취소
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        container.innerHTML = `<div class="empty-state"><p>예약 목록을 불러올 수 없습니다.</p></div>`;
    }
}

async function cancelReservation(reservationId) {
    if (!confirm('예약을 취소하시겠습니까?')) return;
    
    try {
        const response = await fetch(`/api/reservations/${reservationId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                emp_code: currentUser.empCode || currentUser.loginId
            })
        });
        
        if (response.ok) {
            showToast('예약이 취소되었습니다.', 'success');
            renderMyReservations();
        } else {
            showToast('예약 취소 실패', 'error');
        }
    } catch (error) {
        showToast('예약 취소 중 오류가 발생했습니다.', 'error');
    }
}

// ===========================================
// 내 정보 저장
// ===========================================
async function saveMyInfo() {
    const email = document.getElementById('info-email').value.trim();
    
    try {
        const response = await fetch('/api/users/me', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                emp_code: currentUser.empCode,
                login_id: currentUser.loginId,
                email: email
            })
        });
        
        if (response.ok) {
            currentUser.email = email;
            showToast('정보가 저장되었습니다.', 'success');
        } else {
            showToast('저장 실패', 'error');
        }
    } catch (error) {
        showToast('저장 중 오류가 발생했습니다.', 'error');
    }
}

// ===========================================
// 유틸리티 함수
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
    setTimeout(() => toast.classList.add('hidden'), 4000);
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

// 전역 함수
window.openBookModal = openBookModal;
window.returnBook = returnBook;
window.cancelReservation = cancelReservation;
