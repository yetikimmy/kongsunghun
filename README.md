# KONG,SUNG-HUN — 홈페이지

작가 공성훈 홈페이지. 이 저장소는 두 가지를 포함합니다.

1. **레거시 사이트** — 저장소 루트의 `*.htm`, `image/`, `kong.swf` 등. Dreamweaver 테이블 레이아웃 + Flash 기반의 원본 사이트로, **그대로 보존**합니다. 이번 현대화 작업에서 수정/삭제하지 않습니다.
2. **신규 사이트 (Astro)** — `src/`, `public/` 기반의 정적 사이트. Figma 문서 `[외주] 공성훈님 홈페이지` 기준으로 재구축 중입니다.

## 개발

```bash
npm install
npm run dev      # 로컬 개발 서버
npm run build    # dist/ 로 정적 빌드
npm run preview  # 빌드 결과 미리보기
npm run check    # astro check (타입 체크)
```

## 구조

```
src/
  layouts/      BaseLayout.astro
  components/   Header, Navigation, WorksDropdown, WorkGrid, WorkDetail
  content/      works/ (데이터) + config.ts (스키마)
  lib/          nav.ts (메뉴/카테고리 정의)
  pages/        /, /works/, /works/[series]/, /works/[series]/[slug], /cv, /contact, /exhibition, /essay
  styles/       tokens.css (디자인 토큰), global.css
public/
  assets/works/ originals/ · web/(커밋된 작품 이미지) · thumb/ · legacy/(스크립트 생성, 미커밋)
scripts/
  extract-legacy-works.mjs  레거시 HTML(EUC-KR) → JSON 추출
  build-images.mjs          이미지 변환 스크립트 (placeholder)
data/
  legacy-works.generated.json  전체 자동 추출 결과 (검수용)
docs/
  migration.md  추출 스크립트 사용법·한계·웹폰트 로딩 방식
```

## 디자인 토큰 (Figma 기준)

- 데스크탑 1440×1024 · 콘텐츠 영역 약 1000px · 12컬럼/8px gutter
- 모바일 390×844 · 8컬럼/4px gutter/16px margin
- 폰트: 로고/내비 Geist Mono, 제목/카테고리 라벨 Geist Sans, 한글/본문/캡션 Pretendard
- 색상: 흰 배경 + 검정 텍스트, 랜딩은 검정 배경 + 흰 로고
- 타입: 로고 28px, nav 14px, title 28px, body 12px/24px, caption 10px

토큰은 `src/styles/tokens.css` 에 CSS 변수로 정의되어 있고, 768px 브레이크포인트에서 모바일 값으로 전환됩니다.

> 웹폰트는 npm 패키지로 self-host 합니다 (외부 CDN 의존 없음). 로딩 방식·라이선스는 [`docs/migration.md`](docs/migration.md#웹폰트) 참고.

## 작업(works) 데이터 모델

`src/content/works/*.json` (스키마: `src/content/config.ts`).

| 필드 | 설명 |
| --- | --- |
| `slug` | URL 식별자 |
| `series` | blind-work · installation-work · multi-slide-projection · paintings |
| `titleKo` / `titleEn` | 국문/영문 제목 |
| `year` | 제작 연도 (nullable) |
| `medium` | 재료 |
| `dimensions` | 크기 |
| `descriptionKo` / `descriptionEn` | 국문/영문 설명 |
| `images[]` | `{ src, alt, width?, height? }` |
| `caption` | 도판 캡션 |
| `order` | 카테고리 내 정렬 순서 |

현재 카테고리별 3~4개씩 총 12개가 검수되어 등록되어 있습니다. 레거시 HTML 전체(180개) 자동 추출 결과는 `data/legacy-works.generated.json` 에 있으며, 추출 스크립트·한계·수동 검수 항목은 [`docs/migration.md`](docs/migration.md) 에 정리되어 있습니다.

## 이미지 파이프라인 (초안)

`public/assets/works/` 아래 세 단계 디렉터리를 둡니다.

- `originals/` — 원본 (저장소에는 커밋하지 않을 수 있음)
- `web/` — 본문용 (≤1600px)
- `thumb/` — 그리드 썸네일용 (≤600px)

`scripts/build-images.mjs` 는 `sharp` 기반 변환을 염두에 둔 placeholder이며, 실제 대량 변환은 이후 단계에서 구현합니다.
