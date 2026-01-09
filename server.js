/**
 * 사내 도서관 서버 v2.0
 * - 정적 파일 서빙
 * - 도서 데이터 API
 * - 네이버 검색 API 프록시
 * - 관리자 기능
 * - 예약/연체 시스템
 * - SMTP 이메일 알림
 */

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const https = require('https');
const nodemailer = require('nodemailer');

// ===========================================
// 설정
// ===========================================
const PORT = process.env.PORT || 9500;
const DATA_DIR = path.join(__dirname, 'data');
const BOOKS_PATH = path.join(DATA_DIR, 'books.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

// 네이버 API 설정 (.env에서 로드)
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

// 대출 설정
const LOAN_DURATION_DAYS = 14; // 2주
const REMINDER_DAYS = [3, 1];  // 3일전, 1일전 알림
const PENALTY_MULTIPLIER = 1.5; // 연체일 * 1.5배

// MIME 타입
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// ===========================================
// 데이터 로드/저장 유틸리티
// ===========================================
function loadJSON(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
        console.error(`[ERROR] Failed to load ${filePath}:`, e.message);
        return null;
    }
}

function saveJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error(`[ERROR] Failed to save ${filePath}:`, e.message);
        return false;
    }
}

function loadBooks() {
    return loadJSON(BOOKS_PATH) || [];
}

function saveBooks(books) {
    return saveJSON(BOOKS_PATH, books);
}

function loadUsersData() {
    return loadJSON(USERS_PATH) || { users: [], reservations: [], loan_history: [], email_logs: [] };
}

function saveUsersData(data) {
    return saveJSON(USERS_PATH, data);
}

function loadConfig() {
    return loadJSON(CONFIG_PATH) || {};
}

function saveConfig(config) {
    return saveJSON(CONFIG_PATH, config);
}

// ===========================================
// 날짜 유틸리티
// ===========================================
function getToday() {
    return new Date().toISOString().split('T')[0];
}

function addDays(dateStr, days) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
}

function daysBetween(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = d2 - d1;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function isThisMonth(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

// ===========================================
// 사용자 관리
// ===========================================
function getOrCreateUser(empCode, loginId, name, deptCode, deptName, email) {
    const data = loadUsersData();
    let user = data.users.find(u => u.emp_code === empCode || u.login_id === loginId);
    
    if (!user) {
        // 신규 사용자 생성
        user = {
            emp_code: empCode || '',
            login_id: loginId || '',
            name: name || loginId || empCode,
            email: email || '',  // SSO 이메일 저장
            dept_code: deptCode || '',
            dept_name: deptName || '',
            is_admin: false,
            penalty_until: null,
            created_at: getToday()
        };
        data.users.push(user);
        saveUsersData(data);
    } else if (email && !user.email) {
        // 기존 사용자인데 이메일이 없으면 SSO 이메일로 업데이트
        user.email = email;
        saveUsersData(data);
    }
    
    return user;
}

function updateUser(empCode, updates) {
    const data = loadUsersData();
    const index = data.users.findIndex(u => u.emp_code === empCode || u.login_id === empCode);
    
    if (index !== -1) {
        data.users[index] = { ...data.users[index], ...updates };
        saveUsersData(data);
        return data.users[index];
    }
    return null;
}

function isAdmin(empCode, loginId) {
    const config = loadConfig();
    const adminCodes = config.admin_codes || [];
    return adminCodes.includes(empCode) || adminCodes.includes(loginId);
}

function checkPenalty(empCode) {
    const data = loadUsersData();
    const user = data.users.find(u => u.emp_code === empCode || u.login_id === empCode);
    
    if (user && user.penalty_until) {
        const today = getToday();
        if (today < user.penalty_until) {
            return {
                isPenalized: true,
                until: user.penalty_until,
                daysLeft: daysBetween(today, user.penalty_until)
            };
        } else {
            // 패널티 기간 종료
            user.penalty_until = null;
            saveUsersData(data);
        }
    }
    return { isPenalized: false };
}

function applyPenalty(empCode, overdueDays) {
    const penaltyDays = Math.round(overdueDays * PENALTY_MULTIPLIER);
    const penaltyUntil = addDays(getToday(), penaltyDays);
    
    const data = loadUsersData();
    const user = data.users.find(u => u.emp_code === empCode || u.login_id === empCode);
    
    if (user) {
        user.penalty_until = penaltyUntil;
        saveUsersData(data);
        return { penaltyDays, penaltyUntil };
    }
    return null;
}

// ===========================================
// 예약 관리
// ===========================================
function addReservation(bookId, empCode, name) {
    const data = loadUsersData();
    
    // 중복 예약 체크
    const existing = data.reservations.find(r => 
        r.book_id === bookId && r.emp_code === empCode && r.status === 'waiting'
    );
    if (existing) {
        return { success: false, message: '이미 예약한 도서입니다.' };
    }
    
    const reservation = {
        id: Date.now(),
        book_id: bookId,
        emp_code: empCode,
        name: name,
        reserved_at: getToday(),
        status: 'waiting' // waiting, notified, cancelled, completed
    };
    
    data.reservations.push(reservation);
    saveUsersData(data);
    
    return { success: true, reservation };
}

function getReservations(bookId) {
    const data = loadUsersData();
    return data.reservations
        .filter(r => r.book_id === bookId && r.status === 'waiting')
        .sort((a, b) => a.reserved_at.localeCompare(b.reserved_at));
}

function getMyReservations(empCode) {
    const data = loadUsersData();
    return data.reservations.filter(r => r.emp_code === empCode && r.status === 'waiting');
}

function cancelReservation(reservationId, empCode) {
    const data = loadUsersData();
    const index = data.reservations.findIndex(r => 
        r.id === reservationId && (r.emp_code === empCode || isAdmin(empCode, empCode))
    );
    
    if (index !== -1) {
        data.reservations[index].status = 'cancelled';
        saveUsersData(data);
        return true;
    }
    return false;
}

// ===========================================
// 이메일 발송
// ===========================================
let transporter = null;

function initMailer() {
    const config = loadConfig();
    if (config.smtp && config.smtp.host && config.smtp.user) {
        transporter = nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port || 587,
            secure: config.smtp.secure || false,
            auth: {
                user: config.smtp.user,
                pass: config.smtp.password
            }
        });
        console.log('[SMTP] 메일러 초기화 완료');
        return true;
    }
    console.log('[SMTP] SMTP 설정이 없습니다. 이메일 발송 비활성화.');
    return false;
}

async function sendEmail(to, subject, html) {
    if (!transporter) {
        console.log('[SMTP] 메일러가 초기화되지 않았습니다.');
        return false;
    }
    
    const config = loadConfig();
    
    try {
        await transporter.sendMail({
            from: `"${config.smtp.from_name || '사내 도서관'}" <${config.smtp.from_email || config.smtp.user}>`,
            to: to,
            subject: subject,
            html: html
        });
        
        // 로그 저장
        const data = loadUsersData();
        data.email_logs.push({
            to: to,
            subject: subject,
            sent_at: new Date().toISOString(),
            status: 'sent'
        });
        saveUsersData(data);
        
        console.log(`[SMTP] 이메일 발송 성공: ${to}`);
        return true;
    } catch (error) {
        console.error('[SMTP] 이메일 발송 실패:', error.message);
        return false;
    }
}

function generateReminderEmail(userName, bookTitle, dueDate, daysLeft) {
    return `
    <div style="font-family: 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #4F46E5;">📚 사내 도서관 반납 알림</h2>
        <p>안녕하세요, <strong>${userName}</strong>님!</p>
        <div style="background: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>도서명:</strong> ${bookTitle}</p>
            <p style="margin: 0 0 10px 0;"><strong>반납 예정일:</strong> ${dueDate}</p>
            <p style="margin: 0; color: ${daysLeft <= 1 ? '#EF4444' : '#F59E0B'}; font-weight: bold;">
                반납일까지 ${daysLeft}일 남았습니다.
            </p>
        </div>
        <p>기한 내에 반납해 주시기 바랍니다.</p>
        <p style="color: #6B7280; font-size: 14px;">감사합니다.<br>사내 도서관 드림</p>
    </div>
    `;
}

function generateOverdueEmail(userName, bookTitle, dueDate, overdueDays, penaltyDays) {
    return `
    <div style="font-family: 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #EF4444;">⚠️ 사내 도서관 연체 알림</h2>
        <p>안녕하세요, <strong>${userName}</strong>님!</p>
        <div style="background: #FEE2E2; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>도서명:</strong> ${bookTitle}</p>
            <p style="margin: 0 0 10px 0;"><strong>반납 예정일:</strong> ${dueDate}</p>
            <p style="margin: 0 0 10px 0; color: #EF4444; font-weight: bold;">
                ${overdueDays}일 연체되었습니다.
            </p>
            <p style="margin: 0; color: #991B1B;">
                연체로 인해 <strong>${penaltyDays}일간</strong> 대출이 제한됩니다.
            </p>
        </div>
        <p>빠른 시일 내에 반납해 주시기 바랍니다.</p>
        <p style="color: #6B7280; font-size: 14px;">감사합니다.<br>사내 도서관 드림</p>
    </div>
    `;
}

// ===========================================
// 자동 알림 체크 (스케줄러)
// ===========================================
async function checkAndSendReminders() {
    console.log('[Scheduler] 반납 알림 체크 시작...');
    
    const books = loadBooks();
    const usersData = loadUsersData();
    const today = getToday();
    
    for (const book of books) {
        if (book.loan_status !== '대출 중' || !book.application_date) continue;
        
        const dueDate = addDays(book.application_date, LOAN_DURATION_DAYS);
        const daysLeft = daysBetween(today, dueDate);
        
        // 사용자 이메일 찾기
        const user = usersData.users.find(u => 
            u.name === book.applicant || u.login_id === book.applicant || u.emp_code === book.applicant
        );
        
        if (!user || !user.email) continue;
        
        // 3일전, 1일전 알림
        if (REMINDER_DAYS.includes(daysLeft)) {
            const alreadySent = usersData.email_logs.some(log => 
                log.to === user.email && 
                log.subject.includes(book.book_title) &&
                log.subject.includes(`${daysLeft}일`) &&
                log.sent_at.startsWith(today)
            );
            
            if (!alreadySent) {
                await sendEmail(
                    user.email,
                    `[도서관] 반납 ${daysLeft}일 전 알림 - ${book.book_title}`,
                    generateReminderEmail(user.name, book.book_title, dueDate, daysLeft)
                );
            }
        }
        
        // 연체 알림 (당일 또는 연체)
        if (daysLeft < 0) {
            const overdueDays = Math.abs(daysLeft);
            const alreadySent = usersData.email_logs.some(log => 
                log.to === user.email && 
                log.subject.includes('연체') &&
                log.subject.includes(book.book_title) &&
                log.sent_at.startsWith(today)
            );
            
            if (!alreadySent) {
                const penaltyDays = Math.round(overdueDays * PENALTY_MULTIPLIER);
                await sendEmail(
                    user.email,
                    `[도서관] 연체 알림 - ${book.book_title}`,
                    generateOverdueEmail(user.name, book.book_title, dueDate, overdueDays, penaltyDays)
                );
            }
        }
    }
    
    console.log('[Scheduler] 반납 알림 체크 완료');
}

// ===========================================
// API 유틸리티
// ===========================================
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

function sendJSON(res, data, statusCode = 200) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
}

function sendError(res, message, statusCode = 500) {
    sendJSON(res, { error: message }, statusCode);
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

// ===========================================
// 네이버 API 프록시
// ===========================================
function searchNaverBooks(query) {
    return new Promise((resolve, reject) => {
        const encodedQuery = encodeURIComponent(query);
        const options = {
            hostname: 'openapi.naver.com',
            path: `/v1/search/book.json?query=${encodedQuery}&display=5`,
            method: 'GET',
            headers: {
                'X-Naver-Client-Id': NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
            }
        };

        const apiReq = https.request(options, (apiRes) => {
            let data = '';
            apiRes.on('data', chunk => data += chunk);
            apiRes.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });

        apiReq.on('error', reject);
        apiReq.end();
    });
}

// ===========================================
// 메인 라우터
// ===========================================
async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    console.log(`[${new Date().toISOString()}] ${method} ${pathname}`);

    // CORS
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // API 라우트
    if (pathname.startsWith('/api/')) {
        await handleAPI(req, res, pathname, parsedUrl.query);
        return;
    }

    // 정적 파일
    await serveStaticFile(req, res, pathname);
}

async function handleAPI(req, res, pathname, query) {
    const method = req.method;

    try {
        // =====================
        // 네이버 검색
        // =====================
        if (pathname === '/api/naver-search' && method === 'GET') {
            if (!query.query) return sendError(res, '검색어를 입력해주세요.', 400);
            const result = await searchNaverBooks(query.query);
            return sendJSON(res, result);
        }

        // =====================
        // 도서 API
        // =====================
        if (pathname === '/api/books' && method === 'GET') {
            const books = loadBooks();
            const today = getToday();
            
            // 반납일 정보 추가
            const booksWithDue = books.map(book => {
                if (book.loan_status === '대출 중' && book.application_date) {
                    const dueDate = addDays(book.application_date, LOAN_DURATION_DAYS);
                    const daysLeft = daysBetween(today, dueDate);
                    return {
                        ...book,
                        due_date: dueDate,
                        days_left: daysLeft,
                        is_overdue: daysLeft < 0
                    };
                }
                return book;
            });
            
            return sendJSON(res, booksWithDue);
        }

        // 이달의 신규 도서
        if (pathname === '/api/books/new-this-month' && method === 'GET') {
            const books = loadBooks();
            const newBooks = books.filter(b => isThisMonth(b.added_date));
            return sendJSON(res, newBooks);
        }

        // 도서 저장 (전체)
        if (pathname === '/api/save-books' && method === 'POST') {
            const books = await parseBody(req);
            saveBooks(books);
            return sendJSON(res, { success: true });
        }

        // 도서 추가 (관리자 전용)
        if (pathname === '/api/books' && method === 'POST') {
            const newBook = await parseBody(req);
            
            // 관리자 체크
            if (!isAdmin(newBook._admin_code, newBook._admin_code)) {
                return sendError(res, '관리자 권한이 필요합니다.', 403);
            }
            
            delete newBook._admin_code;
            
            const books = loadBooks();
            newBook.id = Math.max(...books.map(b => b.id), 0) + 1;
            newBook.loan_status = '대출 가능';
            newBook.applicant = '';
            newBook.application_date = null;
            newBook.added_date = getToday(); // 추가일
            
            books.push(newBook);
            saveBooks(books);
            
            return sendJSON(res, { success: true, book: newBook }, 201);
        }

        // 도서 수정 (관리자 전용)
        if (pathname.match(/^\/api\/books\/\d+$/) && method === 'PUT') {
            const bookId = parseInt(pathname.split('/').pop());
            const updates = await parseBody(req);
            
            if (!isAdmin(updates._admin_code, updates._admin_code)) {
                return sendError(res, '관리자 권한이 필요합니다.', 403);
            }
            
            delete updates._admin_code;
            
            const books = loadBooks();
            const index = books.findIndex(b => b.id === bookId);
            
            if (index === -1) {
                return sendError(res, '도서를 찾을 수 없습니다.', 404);
            }
            
            books[index] = { ...books[index], ...updates };
            saveBooks(books);
            
            return sendJSON(res, { success: true, book: books[index] });
        }

        // 도서 삭제 (관리자 전용)
        if (pathname.match(/^\/api\/books\/\d+$/) && method === 'DELETE') {
            const bookId = parseInt(pathname.split('/').pop());
            const { _admin_code } = query;
            
            if (!isAdmin(_admin_code, _admin_code)) {
                return sendError(res, '관리자 권한이 필요합니다.', 403);
            }
            
            const books = loadBooks();
            const index = books.findIndex(b => b.id === bookId);
            
            if (index === -1) {
                return sendError(res, '도서를 찾을 수 없습니다.', 404);
            }
            
            books.splice(index, 1);
            saveBooks(books);
            
            return sendJSON(res, { success: true });
        }

        // =====================
        // 대출/반납
        // =====================
        if (pathname.match(/^\/api\/books\/\d+\/borrow$/) && method === 'POST') {
            const bookId = parseInt(pathname.split('/')[3]);
            const { applicant, emp_code } = await parseBody(req);
            
            // 패널티 체크
            const penalty = checkPenalty(emp_code);
            if (penalty.isPenalized) {
                return sendError(res, `대출 정지 중입니다. (${penalty.until}까지, ${penalty.daysLeft}일 남음)`, 403);
            }
            
            const books = loadBooks();
            const index = books.findIndex(b => b.id === bookId);
            
            if (index === -1) return sendError(res, '도서를 찾을 수 없습니다.', 404);
            if (books[index].loan_status === '대출 중') {
                return sendError(res, '이미 대출 중인 도서입니다.', 400);
            }
            
            books[index].loan_status = '대출 중';
            books[index].applicant = applicant;
            books[index].application_date = getToday();
            
            saveBooks(books);
            
            // 대출 기록 저장
            const data = loadUsersData();
            data.loan_history.push({
                book_id: bookId,
                book_title: books[index].book_title,
                emp_code: emp_code,
                borrowed_at: getToday(),
                due_date: addDays(getToday(), LOAN_DURATION_DAYS),
                returned_at: null
            });
            saveUsersData(data);
            
            return sendJSON(res, { 
                success: true, 
                book: books[index],
                due_date: addDays(getToday(), LOAN_DURATION_DAYS)
            });
        }

        if (pathname.match(/^\/api\/books\/\d+\/return$/) && method === 'POST') {
            const bookId = parseInt(pathname.split('/')[3]);
            const { emp_code } = await parseBody(req);
            
            const books = loadBooks();
            const index = books.findIndex(b => b.id === bookId);
            
            if (index === -1) return sendError(res, '도서를 찾을 수 없습니다.', 404);
            
            const book = books[index];
            const dueDate = addDays(book.application_date, LOAN_DURATION_DAYS);
            const today = getToday();
            const overdueDays = daysBetween(dueDate, today);
            
            let penaltyInfo = null;
            
            // 연체 처리
            if (overdueDays > 0) {
                penaltyInfo = applyPenalty(emp_code, overdueDays);
            }
            
            // 책 상태 업데이트
            books[index].loan_status = '대출 가능';
            books[index].applicant = '';
            books[index].application_date = null;
            
            saveBooks(books);
            
            // 대출 기록 업데이트
            const data = loadUsersData();
            const historyIndex = data.loan_history.findIndex(h => 
                h.book_id === bookId && h.emp_code === emp_code && !h.returned_at
            );
            if (historyIndex !== -1) {
                data.loan_history[historyIndex].returned_at = today;
                data.loan_history[historyIndex].overdue_days = overdueDays > 0 ? overdueDays : 0;
            }
            
            // 예약자 알림 처리
            const reservations = getReservations(bookId);
            if (reservations.length > 0) {
                const nextReserver = reservations[0];
                const reserver = data.users.find(u => u.emp_code === nextReserver.emp_code);
                
                if (reserver && reserver.email) {
                    await sendEmail(
                        reserver.email,
                        `[도서관] 예약 도서 대출 가능 - ${book.book_title}`,
                        `<p>${reserver.name}님, 예약하신 "${book.book_title}"이(가) 반납되어 대출 가능합니다.</p>`
                    );
                }
                
                data.reservations.find(r => r.id === nextReserver.id).status = 'notified';
            }
            
            saveUsersData(data);
            
            return sendJSON(res, { 
                success: true, 
                overdue_days: overdueDays > 0 ? overdueDays : 0,
                penalty: penaltyInfo
            });
        }

        // =====================
        // 예약
        // =====================
        if (pathname.match(/^\/api\/books\/\d+\/reserve$/) && method === 'POST') {
            const bookId = parseInt(pathname.split('/')[3]);
            const { emp_code, name } = await parseBody(req);
            
            const result = addReservation(bookId, emp_code, name);
            if (!result.success) {
                return sendError(res, result.message, 400);
            }
            
            return sendJSON(res, result);
        }

        if (pathname === '/api/reservations/my' && method === 'GET') {
            const reservations = getMyReservations(query.emp_code);
            return sendJSON(res, reservations);
        }

        if (pathname.match(/^\/api\/reservations\/\d+\/cancel$/) && method === 'POST') {
            const reservationId = parseInt(pathname.split('/')[3]);
            const { emp_code } = await parseBody(req);
            
            if (cancelReservation(reservationId, emp_code)) {
                return sendJSON(res, { success: true });
            }
            return sendError(res, '예약 취소 실패', 400);
        }

        // =====================
        // 사용자
        // =====================
        if (pathname === '/api/users/me' && method === 'GET') {
            const { emp_code, login_id, name, dept_code, dept_name, email } = query;
            const user = getOrCreateUser(emp_code, login_id, name, dept_code, dept_name, email);
            const penalty = checkPenalty(emp_code || login_id);
            
            return sendJSON(res, {
                ...user,
                is_admin: isAdmin(emp_code, login_id),
                penalty: penalty
            });
        }

        if (pathname === '/api/users/me' && method === 'PUT') {
            const updates = await parseBody(req);
            const user = updateUser(updates.emp_code || updates.login_id, updates);
            
            if (user) {
                return sendJSON(res, { success: true, user });
            }
            return sendError(res, '사용자 업데이트 실패', 400);
        }

        // =====================
        // 관리자 API
        // =====================
        if (pathname === '/api/admin/users' && method === 'GET') {
            if (!isAdmin(query._admin_code, query._admin_code)) {
                return sendError(res, '관리자 권한이 필요합니다.', 403);
            }
            
            const data = loadUsersData();
            return sendJSON(res, data.users);
        }

        if (pathname === '/api/admin/users' && method === 'PUT') {
            const body = await parseBody(req);
            
            if (!isAdmin(body._admin_code, body._admin_code)) {
                return sendError(res, '관리자 권한이 필요합니다.', 403);
            }
            
            delete body._admin_code;
            const user = updateUser(body.emp_code || body.login_id, body);
            
            if (user) {
                return sendJSON(res, { success: true, user });
            }
            return sendError(res, '사용자 업데이트 실패', 400);
        }

        if (pathname === '/api/admin/config' && method === 'GET') {
            if (!isAdmin(query._admin_code, query._admin_code)) {
                return sendError(res, '관리자 권한이 필요합니다.', 403);
            }
            
            return sendJSON(res, loadConfig());
        }

        if (pathname === '/api/admin/config' && method === 'PUT') {
            const body = await parseBody(req);
            
            if (!isAdmin(body._admin_code, body._admin_code)) {
                return sendError(res, '관리자 권한이 필요합니다.', 403);
            }
            
            delete body._admin_code;
            saveConfig(body);
            initMailer(); // SMTP 재설정
            
            return sendJSON(res, { success: true });
        }

        if (pathname === '/api/admin/loans' && method === 'GET') {
            if (!isAdmin(query._admin_code, query._admin_code)) {
                return sendError(res, '관리자 권한이 필요합니다.', 403);
            }
            
            const books = loadBooks();
            const loans = books.filter(b => b.loan_status === '대출 중').map(book => {
                const dueDate = addDays(book.application_date, LOAN_DURATION_DAYS);
                const daysLeft = daysBetween(getToday(), dueDate);
                return {
                    ...book,
                    due_date: dueDate,
                    days_left: daysLeft,
                    is_overdue: daysLeft < 0
                };
            });
            
            return sendJSON(res, loans);
        }

        if (pathname === '/api/admin/stats' && method === 'GET') {
            if (!isAdmin(query._admin_code, query._admin_code)) {
                return sendError(res, '관리자 권한이 필요합니다.', 403);
            }
            
            const books = loadBooks();
            const data = loadUsersData();
            
            const stats = {
                total_books: books.length,
                available_books: books.filter(b => b.loan_status === '대출 가능').length,
                borrowed_books: books.filter(b => b.loan_status === '대출 중').length,
                total_users: data.users.length,
                active_reservations: data.reservations.filter(r => r.status === 'waiting').length,
                new_books_this_month: books.filter(b => isThisMonth(b.added_date)).length,
                overdue_count: books.filter(b => {
                    if (b.loan_status !== '대출 중' || !b.application_date) return false;
                    const dueDate = addDays(b.application_date, LOAN_DURATION_DAYS);
                    return daysBetween(getToday(), dueDate) < 0;
                }).length
            };
            
            return sendJSON(res, stats);
        }

        // 404
        return sendError(res, 'API를 찾을 수 없습니다.', 404);

    } catch (error) {
        console.error('[API Error]', error);
        return sendError(res, '서버 오류가 발생했습니다.', 500);
    }
}

async function serveStaticFile(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/admin') pathname = '/admin.html';

    const filePath = path.join(__dirname, pathname);
    
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    try {
        await fs.promises.access(filePath);
        const content = await fs.promises.readFile(filePath);
        const mimeType = getMimeType(filePath);
        
        res.writeHead(200, {
            'Content-Type': mimeType,
            'Cache-Control': 'public, max-age=3600'
        });
        res.end(content);
        
    } catch (error) {
        if (error.code === 'ENOENT') {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>404 - 페이지를 찾을 수 없습니다</h1>');
        } else {
            res.writeHead(500);
            res.end('Server Error');
        }
    }
}

// ===========================================
// 서버 시작
// ===========================================
const server = http.createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('  📚 사내 도서관 서버 v2.0');
    console.log('='.repeat(60));
    console.log(`  포트: ${PORT}`);
    console.log(`  URL: http://localhost:${PORT}`);
    console.log(`  관리자: http://localhost:${PORT}/admin`);
    console.log('');
    console.log('  대출 기간: 14일 (2주)');
    console.log('  연체 패널티: 연체일 × 1.5배');
    console.log('  알림: 3일전, 1일전, 연체시');
    console.log('='.repeat(60));
    
    // 메일러 초기화
    initMailer();
    
    // 매일 오전 9시에 알림 체크 (간단한 스케줄러)
    setInterval(checkAndSendReminders, 60 * 60 * 1000); // 1시간마다
    
    // 서버 시작 시 한번 실행
    setTimeout(checkAndSendReminders, 5000);
});

process.on('SIGTERM', () => {
    console.log('\n서버 종료 중...');
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    console.log('\n서버 종료 중...');
    server.close(() => process.exit(0));
});
