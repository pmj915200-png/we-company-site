# 위컴퍼니 WE COMPANY 회사 소개 사이트

동대문 여성복 사입대행, 외주 공장 생산, 해외 수출 납품을 소개하는 한국어/일본어 회사 사이트입니다.
관리자 로그인 후 브라우저에서 사진, 회사소개서, 문구를 직접 올리고 고칠 수 있습니다.

- `/` 사이트 (한국어 기본, `/#ja` 일본어)
- `/admin` 관리자 로그인 → 편집 모드

## 구조

| 경로 | 내용 |
|---|---|
| `server.js` | Express 서버. 페이지 제공, 관리자 로그인, 업로드, 저장 API |
| `public/index.html` | 사이트 화면 (디자인, 한국어/일본어 문구, 편집 UI) |
| `public/admin.html` | 관리자 로그인 화면 |
| `default-site.json` | 처음 실행할 때 쓰는 기본 문구와 기본 공장 사진 목록 |
| `seed/uploads/` | 기본 외주 공장 사진. 서버 시작 시 데이터 폴더로 복사되고, 공장 사진이 비어 있는 사이트에 한 번만 추가됩니다 |
| `DATA_DIR/site.json` | 저장된 회사 정보와 사진 목록 (실행 중 생성) |
| `DATA_DIR/uploads/` | 올린 사진과 PDF (실행 중 생성) |

`DATA_DIR`는 `DATA_DIR` 환경 변수 → Railway Volume 경로(`RAILWAY_VOLUME_MOUNT_PATH`) → `./data` 순서로 정해집니다.

## 로컬 실행

```bash
npm install
ADMIN_PASSWORD=원하는비밀번호 npm start
```

http://localhost:3000 에서 확인하고, http://localhost:3000/admin 에서 로그인합니다.

## Railway 배포

1. Railway에서 **New Project → Deploy from GitHub repo**로 이 저장소를 선택합니다. `npm start`로 자동 실행됩니다.
2. 서비스의 **Variables**에 추가합니다.
   - `ADMIN_PASSWORD`: 관리자 비밀번호 (필수, 길게)
   - `SESSION_SECRET`: 아무 긴 임의 문자열 (권장)
3. 서비스에 **Volume**을 추가하고 Mount path를 `/data`로 정합니다.
   Volume이 없으면 재배포할 때 올린 사진과 수정한 문구가 사라집니다.
4. **Settings → Networking → Generate Domain**으로 주소를 만들거나, 보유한 도메인을 연결합니다.

코드를 GitHub에 푸시하면 Railway가 자동으로 다시 배포합니다. 사진과 문구는 Volume에 있으므로 유지됩니다.

## 편집 방법

1. `/admin`에서 비밀번호로 로그인하면 편집 모드로 열립니다.
2. 사진 올리기, 설명(한국어/日本語) 입력, 순서 변경, 삭제, 대표 이미지 지정, 회사소개서(한국어/일본어 PDF) 업로드, 연락처 입력을 합니다.
3. 오른쪽 아래 **저장하고 게시**를 눌러야 방문자 화면에 반영됩니다.

업로드 제한: JPG, PNG, WEBP, GIF, PDF / 파일당 20MB. 큰 사진은 올릴 때 자동으로 줄어듭니다.

## 백업

Railway Volume의 `site.json`과 `uploads/` 폴더가 사이트 내용 전부입니다. 정기적으로 내려받아 보관하세요.
