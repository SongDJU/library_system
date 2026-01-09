# 사내 도서관 시스템

Amaranth10 SSO 연동 사내 도서관 관리 시스템

## 기능

- **SSO 연동**: Amaranth10 GET 방식 파라미터 수신
- **도서 관리**: 목록, 검색, 필터링
- **대출/반납**: 2주 대출기간, 연체 시 패널티 (연체일 × 1.5배)
- **예약**: 대출 중인 도서 예약, 반납 시 알림
- **이메일 알림**: 반납 3일전, 1일전, 연체 시 자동 발송
- **관리자 페이지**: 도서 추가/수정/삭제, 사용자 관리, 대출현황

## 설치 및 실행

### 1. 패키지 설치
```bash
npm install
```

### 2. 환경변수 설정
`.env.example`을 복사하여 `.env` 파일 생성:
```bash
cp .env.example .env
```

`.env` 파일 편집:
```env
PORT=9500
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret
```

> 네이버 API 키는 https://developers.naver.com/apps 에서 발급받으세요.

### 3. 서버 실행
```bash
npm start
```

### 4. 접속
- 사용자: http://localhost:9500
- 관리자: http://localhost:9500/admin

## SSO 파라미터

| Key | Value | 설명 |
|-----|-------|------|
| emp_code | 사원코드 | 사원 고유 코드 |
| login_id | 로그인계정 | 로그인 ID |
| email | 이메일 | 알림 수신용 이메일 |
| dept_code | 부서코드 | 부서 코드 |
| company_code | 회사코드 | 회사 코드 |

## 관리자 설정

`/data/config.json`에서 관리자 코드 설정:
```json
{
  "admin_codes": ["ADMIN001", "admin"]
}
```

## SMTP 설정 (이메일 알림)

관리자 페이지 > 설정 탭에서 SMTP 정보 입력

Gmail 사용 시:
- 호스트: smtp.gmail.com
- 포트: 587
- 비밀번호: [앱 비밀번호](https://myaccount.google.com/apppasswords) 사용

## 파일 구조

```
├── server.js           # 메인 서버
├── index.html          # 사용자 페이지
├── admin.html          # 관리자 페이지
├── css/
│   ├── style.css       # 공통 스타일
│   └── admin.css       # 관리자 스타일
├── js/
│   ├── app.js          # 사용자 로직
│   └── admin.js        # 관리자 로직
├── data/
│   ├── books.json      # 도서 데이터
│   ├── users.json      # 사용자/예약 데이터
│   └── config.json     # 설정
├── .env                # 환경변수 (git 제외)
└── .env.example        # 환경변수 예시
```
