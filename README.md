# PS1SWP

사회복지현장실습 신청, 승인, 실습지 관리, 1-3순위 신청, 사다리 추첨을 관리하는 정적 웹앱입니다.

## 주요 기능

- 학생 가입 승인, 부관리자 최대 3명 지정, 강제 탈퇴
- 학생별 실습지 1-3순위 신청
- 관리자 실습지 최대 100개 등록
- 사다리 추첨 시 당첨자 수 직접 설정
- 관리자와 학생 간 쪽지
- 관리자가 지정한 Google Drive 폴더 기반 실습 파일 제출
- 실습처 공유링크, 슈퍼바이저 이메일, 메모 제출
- 관리자 전체 결과 엑셀 다운로드

## 기본 계정

- 관리자 ID: `PS1`
- 관리자 비밀번호: `10041005`

첫 실행 시 데이터베이스에 관리자 계정이 없으면 자동으로 생성됩니다.

## Firebase 연결

이 앱은 Firebase SDK를 내려받지 않고 Realtime Database REST API만 사용합니다. 그래서 페이지 로딩이 가볍고, 실시간 리스너를 쓰지 않아 다운로드 사용량을 줄입니다.

현재 설정 파일: `firebase-config.js`

```js
window.PS1SWP_CONFIG = {
  databaseURL: "https://ps1swp-default-rtdb.firebaseio.com",
  useRemoteDatabase: true,
};
```

Firebase Realtime Database 규칙은 `database.rules.json`에 있습니다. 콘솔에서 직접 붙여넣거나 Firebase CLI를 사용해 배포할 수 있습니다.

```bash
firebase login
firebase use ps1swp
firebase deploy --only database,hosting
```

## Vercel 배포

GitHub 저장소 `https://github.com/lovecasework/PS1SWP`에 이 폴더의 파일을 올린 뒤 Vercel에서 해당 저장소를 연결합니다.

- Framework Preset: Other
- Build Command: 비워둠
- Output Directory: 비워둠 또는 `.`

`vercel.json`이 모든 경로를 `index.html`로 연결합니다.

## Firebase 사용량을 줄이는 방식

- Firebase JS SDK를 사용하지 않습니다.
- 앱 시작과 새로고침 버튼을 누를 때만 데이터를 읽습니다.
- 저장할 때 변경된 노드만 `PUT`, `PATCH`, `DELETE`합니다.
- 사다리 결과 이미지는 데이터베이스에 저장하지 않고 결과 데이터만 저장합니다.
- 학생에게 보낼 결과는 브라우저에서 즉시 이미지로 저장합니다.
- 실습 파일은 Firebase Storage에 업로드하지 않고 지정 Google Drive 폴더에 학생이 직접 업로드합니다.
- 학생 비밀번호는 관리자 화면에 직접 노출하지 않고, 필요한 경우 전체 결과 엑셀에서 확인합니다.

## 실습 파일 제출 방식

관리자는 파일 메뉴에서 학생이 사용할 Google Drive 위치와 폴더 이름을 저장할 수 있습니다. 기본 제출 위치는 `실습파일` 폴더(`https://drive.google.com/drive/folders/1Grg6Cmmm0tCQX0op8qO6dMwoToW5lHAQ`)입니다. 학생은 지정된 Drive 위치를 열고 `학번_이름` 형식의 폴더를 직접 만든 뒤 워드, PDF 등 실습 관련 파일을 넣습니다. 앱에는 실습처 공유링크, 슈퍼바이저 이메일 주소, 관리자에게 전달할 메모만 제출합니다.

이 방식은 Google OAuth나 Drive API 연동 없이 운영할 수 있어 Firebase 사용량과 파일 저장 비용을 줄이는 데 가장 단순합니다.

## 보안 메모

요청사항에 따라 관리자가 학생 비밀번호를 확인할 수 있도록 비밀번호를 그대로 저장합니다. 이 방식은 실제 서비스 보안 기준으로는 안전하지 않습니다. 외부 공개 서비스로 장기간 운영하려면 Firebase Authentication, Cloud Functions, 관리자 전용 인증 규칙, 비밀번호 재설정 링크 방식으로 바꾸는 것을 권장합니다.
