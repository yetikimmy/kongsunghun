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

### 캡션 파싱 (4차 개선 — 순서 독립)

캡션은 제목 뒤에 **연도·크기·재료**가 느슨한 순서로 섞여 옵니다(재료가 연도 앞·뒤
모두 가능, 크기 유무도 제각각). 2차까지의 "연도 위치 기준 분리"는 재료-선행·재료-단독
캡션을 잘못 갈랐습니다. 4차에서 **토큰을 정체로 떼어내는** 방식으로 바꿨습니다.

1. **연도**(`19xx`/`20xx`) 토큰을 떼어냄 — 제목/재료로 새지 않게.
2. **크기**(`130.3x162.2cm` 등) 토큰을 떼어냄.
3. **재료**는 코퍼스 기반 **재료 머리어구**(`Oil on`, `Acrylic on`, `Mixed Media`,
   `Slide Projection`, `Electric Shock Circuit`, `아크릴`, `수제` …)로 시작점을 잡아
   그 지점부터 끝까지를 재료로 봅니다. 머리어구 앞의 수량(`12 Hand-made Slide …`,
   `42대의 수제 …`)은 재료로 흡수합니다. 머리어구가 단어 하나가 아니라 **다어절·특정**
   (`Dust and Acrylic`, `Fluorescent Paint`)이라, 제목 속 같은 단어(`Dust Painting`,
   `Perfect Painting`)를 재료로 오인하지 않습니다.
4. 남은 잔여를 **제목 블록**으로 보고 국문→영문으로 가릅니다.

재료가 **없는** 캡션에서만, 제목 끝에 붙은 `<Name> Gallery|Museum, <City>`처럼
**쉼표 경계가 분명한** 전시 장소를 떼어 `location`으로 옮깁니다. 재료가 있을 때는
장소가 재료 뒤에 붙어 있어도 원문 그대로 둡니다(재료 명사와 장소 고유명사가 모두
대문자라 무리하게 자르면 재료가 잘릴 수 있음).

### `extractionWarnings` 의미

| warning | 의미 / 대응 |
| --- | --- |
| `no-medium` | 캡션에 재료 머리어구가 없음. (단순한 캡션·드로잉·설치뷰 등 실제로 재료가 없는 경우가 대부분.) 단, `installation view`/`detail` 같은 **뷰 라벨**만 남은 경우는 재료 부재로 보지 않아 경고하지 않음. |
| `no-year` | 캡션에 연도가 없음 (예: `install10_01`). `year`가 `null`. |
| `no-caption` | `td.rabbit` 캡션을 못 찾음 → 인덱스/메뉴 페이지일 가능성. |
| `title-from-html-title-tag` | 캡션 제목이 없어 `<title>` 태그에서 가져옴. |
| `title-fallback-slug` | 제목을 전혀 못 찾아 slug로 대체. |
| `title-split-ambiguous` | 제목 안 국문/Latin을 깔끔히 못 가름(영문 괄호 주석 등) → 국문 제목으로 보존. |
| `missing-image:<file>` | 참조 이미지가 `image/`에 실제로 없음. |

> 2차의 `medium-before-year` 경고는 4차 파서가 정상 처리하므로 **더 이상 발생하지
> 않습니다**. 그 외 양성(benign) 경고도 `manualReview`를 띄우지 않습니다.

### 추출 통계 (4차 기준)

- 스캔 파일: **180**
- 추출 레코드: **180** (blind-work 24 · installation-work 56 · paintings 87 · multi-slide-projection 13)
- 복사 이미지: **222**
- warning 있는 레코드: **15** / 총 warning: **17** (2차 64/66 → 4차 15/17)

### 한계 · 수동 검수 필요 항목

- **국문/영문 분리 휴리스틱**: 설명·제목을 "첫 ASCII 구간"으로 가릅니다. 한 문단 안에
  국·영문이 섞이면(`art ∩ life …` 같은 수식, 영문 인용 등) 경계가 어긋날 수 있습니다.
  검수 대상 entry는 `caption`/`rawCaption` 원본과 대조하세요.
- **인덱스 페이지(`install.htm` / `painting.htm` 등)**: 작품 썸네일 네비게이션
  페이지는 content entry로 만들지 않습니다(import 단계에서 `INDEX_LEGACY_FILES`로 제외).
- **다중 이미지 페이지**: 일부 install 페이지는 여러 작품 뷰를 가집니다. 자동 추출은
  같은 페이지의 이미지를 한 레코드에 묶습니다.

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

1. **검수 entry 우선 (curated wins).** 손으로 다듬은 12개 entry는 사람이 읽기 좋은
   slug(예: `self-portrait`)를 씁니다. 스크립트는 **slug가 레거시 파일명 stem과 다른**
   entry만 검수본으로 인식해(=`slug !== legacyStem(legacyFile)`) `legacyFile`로 색인하고,
   같은 레거시 페이지에서 나온 생성 레코드는 **건너뜁니다**. 검수 메타데이터는 절대
   덮어쓰지 않습니다. (3차까지는 생성 entry까지 검수본으로 오인해 재생성이 0건이던 버그를
   4차에서 수정.)
2. **slug = 레거시 파일명 stem** (`bw01`, `install01_1`, `paint09_03`, …). 레거시
   사이트는 작품 뷰 1개당 HTML 파일 1개라 stem이 이미 전역 유일합니다(중복 0). 제목은
   중복·잡음이 많아 slug 근거로 쓰지 않습니다.
3. **인덱스 페이지 제외.** `install.htm`/`painting.htm`/`multi.htm`/`real.htm`은
   네비게이션 썸네일 격자일 뿐 작품이 아니므로 entry로 만들지 않습니다
   (`INDEX_LEGACY_FILES`).
4. **깨진 이미지 없음.** 참조된 작품 이미지를 루트 `image/`에서 커밋 대상인
   `public/assets/works/web/`로 복사하고 `/assets/works/web/<file>`로 참조합니다.
   디스크에 없는 파일은 entry에서 제외하고 `reviewNotes`에 기록합니다(죽은 `src` 미발행).
5. **검수 추적 — 구체적·actionable.** `extractionWarnings`는 그대로 전달하되,
   `manualReview`는 **실제로 미해결인 경우에만** 띄웁니다. 경고 코드를 사람이 바로
   조치할 수 있는 `reviewNotes` 문장으로 매핑하고(`REVIEW_NOTE_BY_WARNING`),
   재료가 없고·뷰 라벨도 아닌 제목에 전시기관어(`Gallery`/`Museum`/`Art Center`)가
   남아 있으면 "장소를 `location`으로 옮기라"는 노트를 추가합니다. 양성 경고는 노트로
   만들지 않습니다.

멱등(idempotent): 재실행 시 생성 entry만 제자리 갱신하고 검수 entry는 그대로 둡니다.
`--clean`은 더 이상 생성되지 않는 옛 생성 entry를 정리합니다.

import 결과 (4차):

| 시리즈 | 검수(보존) | 생성(import) | 합계 |
| --- | --- | --- | --- |
| blind-work | 2 | 22 | 24 |
| installation-work | 3 | 52 | 55 |
| multi-slide-projection | 3 | 10 | 13 |
| paintings | 4 | 82 | 86 |
| **합계** | **12** | **166** | **178** |

- 인덱스 페이지 2건(`install.htm`, `painting.htm`)을 제외해 합계가 180 → **178**.
- 커밋 이미지: **185** (`public/assets/works/web/`)
- `manualReview: true` entry: **71 → 12** (4차). 남은 12건은 레거시 캡션이 **실제로**
  재료/연도를 적지 않았거나 제목에 장소가 섞인, 사실 확인 없이는 자동 보정할 수 없는
  항목입니다. UI는 정상 동작합니다.

#### 남은 검수 항목 (12건)

| slug | 시리즈 | 사유 |
| --- | --- | --- |
| `install03_1` | installation-work | 재료 없음 · 제목에 장소(`National Museum of Contemporary Art, Gwachoen`) 잔존 |
| `install04_1` | installation-work | 재료 없음 (드로잉 캡션) |
| `install07_1` | installation-work | 재료 없음 (드로잉 캡션) |
| `install10_01` | installation-work | 연도 없음 (`(Installation View)` 캡션) |
| `install10_02`–`install10_05` | installation-work | 재료 없음 |
| `install14_1` | installation-work | 재료 없음 (`Kiss 1998`) |
| `slide02_02` | multi-slide-projection | 재료 없음 |
| `slide04_02`, `slide04_03` | multi-slide-projection | 재료 없음 · 제목에 장소(`… Museum …`) 잔존 |

#### 수동 검수 이어가는 법

1. `src/content/works/*.json`에서 `"manualReview": true` 항목을 엽니다.
2. 같은 entry의 `caption`(원본 캡션)과 `legacyFile`이 가리키는 레거시 `.htm`을
   대조해 누락된 `medium`/`year`를 **원본에 있는 경우에만** 채웁니다(사실 날조 금지).
3. 제목에 장소가 섞였으면 장소를 `location`으로 옮기고 `titleEn`을 다듬습니다.
4. 충분히 해소되면 `manualReview`와 `reviewNotes`를 **삭제**합니다(둘 다 옵션 필드).
5. slug를 사람이 읽기 좋은 이름으로 바꾸면(예: `install14_1` → `kiss`) 그 entry는
   자동으로 **검수본**으로 인식되어 이후 `import:works` 재실행 시 보존됩니다.

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
| `src/pages/exhibition.astro` | `cv.htm`(국문) · `cv02.htm`(영문) | C.V.의 전시 섹션(개인전/2인전/주요 단체전 — SOLO/DUO/GROUP)만 추려 렌더. 데이터는 `src/data/exhibitions.ts`가 `legacy-pages.generated.json`의 CV에서 **파생**(별도 추출 스크립트 없음). 각 줄을 앞쪽 4자리 연도와 나머지(제목·장소) 텍스트로 분리해 표 형태로 표시. 국·영문 두 독립 블록. |
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
- **EXHIBITION 파생**: 전시 페이지는 별도 추출 없이 C.V.의 전시 섹션을 재사용합니다.
  각 줄은 `^(19|20)\d{2}\s+(...)` 정규식으로 **연도 + 나머지 텍스트**로만 분리하며,
  장소·도시는 더 쪼개지 않고 원문 콤마 표기를 그대로 둡니다(사실 날조 방지).
- **레거시 줄바꿈으로 분리된 영문 단체전 항목**: `cv02.htm` 원문에서 일부 항목이 두 줄로
  끊겨 있어(예: `Busan Biennale 2006 Cafe 1 : ...` / `Busan Museum of Modern Art, Busan`,
  그리고 앞 연도가 없는 `The New Generational Tendency ...` 연속 줄) 추출 시 별개 항목으로
  들어옵니다. 연도가 없는 줄은 `year`를 비워 원문 그대로 보존하며, 임의 병합하지 않았습니다.
  교정이 필요하면 `cv02.htm` 원본 기준으로 별도 콘텐츠 작업에서 합칩니다.

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

빌드 결과(`dist/`, 4차)에서 확인한 사항:

- woff2 폰트 번들 (Geist Sans/Mono + Pretendard Variable 한글 서브셋)
- 작품 상세 페이지 **178개**(인덱스 페이지 2건 제외) + 시리즈 인덱스 4 + 정보/기타 페이지
- 한글 제목·연도·매체, CV/에세이 한글 본문, CONTACT 정상 표기
- 깨진 이미지 0, `public/assets/works/web/` **185개** 커밋
- 내비/페이지 링크가 상대경로로 정상 해석 (서브패스 프리뷰 호환)
