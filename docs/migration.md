# 현대화 마이그레이션 노트

레거시 Dreamweaver/Flash 사이트(`*.htm`, `image/`, `kong.swf`)를 Astro 정적 사이트로
이관하는 과정과, 그 과정에서 생긴 도구·데이터·한계를 정리한 문서입니다.

레거시 원본은 **그대로 보존**합니다. 이 문서에서 다루는 변경은 모두 새 Astro 구조
(`src/`, `public/`, `scripts/`, `data/`, `docs/`)에 한정됩니다.

---

## 레거시 작품 데이터 추출

### 스크립트

```bash
npm run extract:legacy        # = node scripts/extract-legacy-works.mjs
```

- 대상 파일: 루트의 `bw*.htm`, `install*.htm`, `paint*.htm`, `slide*.htm`
- 출력:
  - `data/legacy-works.generated.json` — 전체 자동 추출 결과(검수용, 커밋함)
  - `public/assets/works/legacy/*.jpg` — 참조된 작품 이미지 복사본
    (재생성 가능하므로 `.gitignore`, 커밋하지 않음)

### 인코딩 전략 (EUC-KR)

레거시 HTML은 모두 **EUC-KR**로 저장되어 있습니다(`<meta charset="euc-kr">`).
Node 기본 디코더는 EUC-KR을 지원하지 않으므로 `iconv-lite`로 버퍼를 디코딩합니다.

```js
import iconv from "iconv-lite";
const text = iconv.decode(readFileSync(path), "euc-kr");
```

이렇게 디코딩한 뒤 UTF-8(JSON)로 출력하므로 한글이 깨지지 않습니다. (검증:
생성된 JSON과 빌드 결과 HTML에서 한글 정상 표기 확인.)

### 추출 필드

레거시 페이지는 일관된 Dreamweaver 테이블 레이아웃을 가집니다.

- 시리즈 라벨 GIF (`image/blindwork.gif`, `image/install01.gif`, …)
- 작품 JPG (`image/bwp01.jpg`, `image/in01_01.jpg`, …)
- `td.rabbit` 셀의 **한 줄 캡션**: `국문제목  영문제목  연도  재료  크기  장소`
  (필드 구분이 들쭉날쭉 — 2칸 이상 공백이 기본이나 1칸인 경우도 있음)
- `td.gong01` 셀의 **설명 문단**: 국문 → 영문 순, `<br>` 구분

생성 레코드의 필드:

| 필드 | 설명 |
| --- | --- |
| `legacyFile` | 원본 파일명 (출처 추적) |
| `series` | `bw→blind-work`, `install→installation-work`, `slide→multi-slide-projection`, `paint→paintings` |
| `slug` | 파일명 기반 식별자 |
| `titleKo` / `titleEn` | 국문/영문 제목 (없으면 서로 fallback, 최후엔 `<title>` 또는 slug) |
| `year` | 캡션에서 찾은 4자리 연도 (`19xx`/`20xx`), 없으면 `null` |
| `medium` | 재료 |
| `dimensions` | `40x40x3cm`, `130.3x162.2cm` 등 |
| `images[]` | `{ src, publicSrc, width?, height? }` |
| `caption` / `rawCaption` | 원본 캡션 한 줄 전체 |
| `descriptionKo` / `descriptionEn` | 설명(국문/영문 분리) |
| `order` | 시리즈 내 등장 순서 |
| `extractionWarnings[]` | 자동 추출이 확신하지 못한 항목 (숨기지 않고 기록) |

### 이미지 후보 선별

- **제외**: 모든 `.gif` (레거시 작품은 전부 `.jpg`). GIF는 라인/네비게이션/시리즈
  라벨 등 UI 크롬임 (`line.gif`, `back.gif`, `next*.gif`, `blindwork.gif` 등).
- **포함**: `image/` 아래 `.jpg` 작품 이미지.

### `extractionWarnings` 의미

| warning | 의미 / 대응 |
| --- | --- |
| `medium-before-year` | 캡션에서 재료·크기가 연도보다 **앞**에 옴 (예: `Blind-work 150x300cm … 1991`). 스크립트가 분리는 했으나, 제목/재료 경계는 수동 확인 권장. |
| `no-medium` | 연도 뒤에 재료 텍스트가 없음 (캡션이 실제로 간단한 경우 많음). |
| `no-year` | 캡션에 연도가 없음 (예: `install10_01`). `year`가 `null`. |
| `no-caption` | `td.rabbit` 캡션을 못 찾음 → 인덱스/메뉴 페이지일 가능성 (`install.htm`, `painting.htm`). |
| `title-from-html-title-tag` | 캡션 제목이 없어 `<title>` 태그에서 가져옴. |
| `title-fallback-slug` | 제목을 전혀 못 찾아 slug로 대체. |
| `missing-image:<file>` | 참조 이미지가 `image/`에 실제로 없음. |

### 추출 통계 (2차 기준)

- 스캔 파일: **180**
- 추출 레코드: **180** (blind-work 24 · installation-work 56 · paintings 87 · multi-slide-projection 13)
- 복사 이미지: **222**
- warning 있는 레코드: **64** / 총 warning: **66**

### 한계 · 수동 검수 필요 항목

- **국문/영문 분리 휴리스틱**: 설명·제목을 "첫 ASCII 구간"으로 가릅니다. 한 문단 안에
  국·영문이 섞이면(`art ∩ life …` 같은 수식, 영문 인용 등) 경계가 어긋날 수 있습니다.
  검수 대상 entry는 `caption`/`rawCaption` 원본과 대조하세요.
- **`install.htm` / `painting.htm`**: 작품 썸네일을 포함한 인덱스 페이지가 레코드로
  남습니다(`no-caption` 경고). 사이트 콘텐츠에는 포함하지 않았습니다.
- **다중 이미지 페이지**: 일부 install 페이지는 여러 작품 뷰를 가집니다. 자동 추출은
  같은 페이지의 이미지를 한 레코드에 묶습니다.
- (2차까지) 자동 추출 전체를 그대로 노출하지 않고 **검수된 12개만** 반영했으나,
  **3차에서 나머지 전체를 import**했습니다 (아래 "전체 작품 import" 참고).

---

## 사이트 콘텐츠 반영

검수된 작품은 `src/content/works/*.json` (스키마 `src/content/config.ts`)에 있습니다.

### 전체 작품 import (3차)

`data/legacy-works.generated.json`(180건) 전체를 content collection으로 옮기는
import 스크립트를 추가했습니다.

```bash
npm run import:works     # = node scripts/import-legacy-works-to-content.mjs --clean
```

설계:

1. **검수 entry 우선 (curated wins).** 손으로 다듬은 12개 entry는 각자
   `legacyFile`을 선언합니다. 스크립트는 이 필드로 검수 entry를 색인하고, 같은 레거시
   페이지에서 나온 생성 레코드는 **건너뜁니다**. 검수된 메타데이터는 절대 덮어쓰지 않습니다.
2. **slug = 레거시 파일명 stem** (`bw01`, `install01_1`, `paint09_03`, …). 레거시
   사이트는 작품 뷰 1개당 HTML 파일 1개라 stem이 이미 전역 유일합니다(중복 0). 제목은
   중복·잡음이 많아 slug 근거로 쓰지 않습니다. 검수 entry는 사람이 읽기 좋은 기존 slug를
   유지합니다.
3. **깨진 이미지 없음.** 참조된 작품 이미지를 루트 `image/`에서 커밋 대상인
   `public/assets/works/web/`로 복사하고 `/assets/works/web/<file>`로 참조합니다.
   디스크에 없는 파일은 entry에서 제외하고 `reviewNotes`에 기록합니다(죽은 `src` 미발행).
4. **검수 추적.** `extractionWarnings`를 그대로 전달하고, 검토가 필요한 entry에는
   `manualReview: true` + `reviewNotes[]`를 설정합니다(UI에는 노출되지 않는 옵션 필드).

멱등(idempotent): 재실행 시 생성 entry만 제자리 갱신하고 검수 entry는 그대로 둡니다.
`--clean`은 더 이상 생성되지 않는 옛 생성 entry를 정리합니다.

import 결과 (3차):

| 시리즈 | 검수(보존) | 생성(import) | 합계 |
| --- | --- | --- | --- |
| blind-work | 2 | 22 | 24 |
| installation-work | 3 | 53 | 56 |
| multi-slide-projection | 3 | 10 | 13 |
| paintings | 4 | 83 | 87 |
| **합계** | **12** | **168** | **180** |

- 커밋 이미지: **222** (`public/assets/works/web/`)
- `manualReview: true` entry: **71** (`reviewNotes`에 사유 기록 — 잡음 제목, 재료
  누락, 연도 누락 등). UI는 정상 동작하며, 추후 사람이 제목·메타데이터를 다듬을 때 참고.

### 이미지 경로 전략

1. **추출 스크립트**(`extract:legacy`)는 검수용으로 참조 이미지를
   `public/assets/works/legacy/`에 복사합니다 (재생성 가능 → `.gitignore`, 미커밋).
2. **import 스크립트**(`import:works`)는 실제로 사이트가 쓰는 222개 이미지를
   `public/assets/works/web/`로 복사해 **커밋**합니다. 사이트는 스크립트 실행 없이도
   정상 동작하고, 깨진 이미지가 없습니다.
3. 추가 안전장치: `WorkGrid`/`WorkDetail`의 `<img>`에 `onerror` 처리 — 로드 실패 시
   회색 placeholder로 폴백.

이미지 최적화(리사이즈/압축)는 아직 미적용입니다(`scripts/build-images.mjs` sharp 기반은
이후 단계). 현재는 원본 jpg를 그대로 사용합니다.

---

## 정보 페이지 (ESSAY · C.V. · CONTACT)

`cv.htm`/`cv02.htm`, `contact.htm`, `essay.htm`/`essay02.htm`(모두 EUC-KR)을 하나의
구조화 JSON으로 추출하고, 각 Astro 페이지가 이 데이터를 렌더합니다.

```bash
npm run extract:pages    # = node scripts/extract-legacy-pages.mjs
                         # → data/legacy-pages.generated.json
```

긴 한글 본문을 `.astro`에 직접 붙여넣지 않고 JSON으로 추출하는 이유: `iconv-lite`로
원본을 그대로 디코드하므로 손으로 옮겨 적을 때의 오타·깨짐이 없고, 한 번에 재생성됩니다.

| 페이지 | 소스 | 구성 |
| --- | --- | --- |
| `src/pages/cv.astro` | `cv.htm`(국문) · `cv02.htm`(영문) | 섹션(학력/개인전/단체전/소장 …)별 목록. 국·영문 항목 수가 달라 **두 개의 독립 블록**으로 렌더(라인 오정렬 방지). |
| `src/pages/contact.astro` | `contact.htm` | 주소·전화·이메일. 이메일은 `mailto:` 링크. |
| `src/pages/essay.astro` | `essay.htm`(국문) · `essay02.htm`(영문) | 인터뷰형 에세이 "Blind Work"(1998). 섹션 헤더·서명 자동 태깅, 국·영문 블록 분리. |

내비게이션은 기존 `MAIN_NAV` + `relativeHref`로 이미 `/essay/` · `/cv/` · `/contact/`에
연결돼 있어, 서브패스 정적 프리뷰에서도 상대경로(`../essay/` 등)로 정상 해석됩니다.

### 한계 · 수동 검수 필요 항목 (정보 페이지)

- **C.V. 국/영 정렬**: 두 CV의 섹션별 항목 수가 다릅니다(예: 단체전 54 vs 56). 라인을
  1:1로 짝지으면 어긋나므로 **국문 전체 → 영문 전체** 순서의 두 블록으로 분리했습니다.
- **레거시 표기 보존**: 원문의 사소한 오타(`Sungkyunkwan Uhiv.` 등)는 추출값 그대로
  둡니다. 교정은 별도 콘텐츠 작업입니다.
- **에세이 섹션 태깅**: `1. 외도` / `1. Deviation` 같은 짧은 번호줄을 헤더로,
  `1998. 2. 공성훈` / `February, 1998. Kong, Sung-Hun`을 서명으로 휴리스틱 태깅합니다.

---

## 웹폰트

### 적용 (Figma 기준)

| 용도 | 폰트 | family |
| --- | --- | --- |
| 로고 / 내비게이션 / pager | Geist Mono | `"Geist Mono"` |
| 제목 / 카테고리 라벨 | Geist Sans | `"Geist Sans"` |
| 한글 / 본문 / 캡션 | Pretendard | `"Pretendard Variable"`, `"Pretendard"` |

토큰: `src/styles/tokens.css`의 `--font-mono` / `--font-display` / `--font-body`.

### 로딩 방식 — npm self-host (외부 CDN 없음)

정적 사이트에 적합하도록 **npm 패키지로 self-host**합니다. 빌드 시 Astro/Vite가
woff2 파일을 `dist/_astro/`로 번들하고 CSS의 URL을 재작성하므로, 런타임에 외부
도메인을 호출하지 않습니다.

```ts
// src/layouts/BaseLayout.astro
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
```

- **Geist Sans / Geist Mono**: `@fontsource/geist-sans`, `@fontsource/geist-mono`
  (Vercel, OFL-1.1). 필요한 weight(400/500/600)만 import.
- **Pretendard**: 공식 `pretendard` 패키지(Kil Hyung-jin, OFL-1.1)의 **variable
  dynamic-subset** CSS. 한글을 다수의 `unicode-range` 서브셋으로 쪼개 제공하므로,
  브라우저가 실제로 쓰이는 글리프 서브셋만 내려받습니다(전송량·레이아웃 흔들림 최소화).
  `@fontsource/pretendard`는 latin 서브셋만 포함해 한글이 없으므로 사용하지 않았습니다.

### CLS / 폴백

- 모든 `@font-face`에 `font-display: swap` (패키지 기본값) — 폰트 로드 전 폴백으로
  먼저 그리고, 로드되면 교체.
- 폴백 스택 지정 (tokens.css):
  - body/한글: `system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`
  - display: `system-ui, -apple-system, "Segoe UI", sans-serif`
  - mono: `ui-monospace, "SFMono-Regular", Menlo, monospace`
- variable 폰트 + unicode-range 서브셋으로 한글 전송량을 최소화해 swap 시 흔들림을 줄였습니다.

### 라이선스 / 출처

| 폰트 | 출처 | 라이선스 |
| --- | --- | --- |
| Geist Sans | Vercel (`@fontsource/geist-sans`) | OFL-1.1 |
| Geist Mono | Vercel (`@fontsource/geist-mono`) | OFL-1.1 |
| Pretendard | Kil Hyung-jin / orioncactus (`pretendard`) | OFL-1.1 |

세 폰트 모두 SIL Open Font License 1.1로, self-host·재배포가 허용됩니다.

---

## 검증

```bash
npm install
npm run extract:legacy   # data/legacy-works.generated.json 재생성
npm run extract:pages    # data/legacy-pages.generated.json 재생성 (CV/CONTACT/ESSAY)
npm run import:works      # 생성 레코드 → src/content/works/*.json (검수 entry 보존)
npm run check            # astro check — 0 errors
npm run build            # 정적 빌드 — 190 pages
```

빌드 결과(`dist/`, 3차)에서 확인한 사항:

- woff2 폰트 번들 (Geist Sans/Mono + Pretendard Variable 한글 서브셋)
- 작품 상세 페이지 **180개** + 시리즈 인덱스 4 + 정보/기타 페이지 = **190 pages**
- 한글 제목·연도·매체, CV/에세이 한글 본문, CONTACT 정상 표기
- 이미지 참조 **402건 전부 해석**(깨진 이미지 0), `web/` 222개 커밋
- 내비/페이지 링크가 상대경로로 정상 해석 (서브패스 프리뷰 호환)
