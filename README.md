# God's Eye Dashboard v1

BTC/USD, VIX, DXY, US10Y, Nasdaq 100, S&P 500과 Fear & Greed Index를 한 화면에서 보는 정적 대시보드입니다.

## Tech

- Vanilla HTML/CSS/JS
- Tailwind CSS (CDN)
- TradingView Embed Widgets
- TradingView Lightweight Charts (위젯 실패 시 Direct Fallback)
- Alternative.me Fear & Greed API
- Firebase Hosting

## Local Preview

정적 파일만 사용하므로 `public/index.html`을 브라우저에서 바로 열어도 동작합니다.  
로컬 서버가 필요하면 아래처럼 실행할 수 있습니다.

```bash
npx serve public
```

## Firebase Deploy (Windows PowerShell 정책 대응)

PowerShell 정책 때문에 `firebase`와 `npm` 실행이 막히는 환경에서는 `cmd /c`를 사용합니다.

```bash
cmd /c firebase login
cmd /c firebase projects:create godseye-dashboard -n GodsEyeDashboard
cmd /c firebase deploy --only hosting --project <projectId>
```

## Files

- `public/index.html`: 레이아웃/위젯 컨테이너
- `public/styles.css`: 다크 테마 + 반응형 레이아웃
- `public/app.js`: TradingView 초기화 + Fear & Greed 폴링/오류 처리
- `firebase.json`: Hosting 대상 디렉터리 설정
- `.firebaserc`: 기본 Firebase 프로젝트 매핑
