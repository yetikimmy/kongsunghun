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
- 자동 추출 전체를 그대로 노출하지 않고, **검수된 12개만** content collection에 반영했습니다.

---

## 사이트 콘텐츠 반영

검수된 작품은 `src/content/works/*.json` (스키마 `src/content/config.ts`)에 있습니다.
2차에서 카테고리별로 다음을 등록했습니다 (총 12개):

- blind-work: `blind-work-1991-150x300`, `blind-work-1992-200x200`
- installation-work: `art-intersection`, `art-is-expensive`, `just-couldnt-say`
- multi-slide-projection: `fall`, `untitled-2002`, `drawing-for-polypod`
- paintings: `a-dog`, `in-the-night`, `self-portrait`, `pine-trees-on-the-cliff`

각 entry에는 출처 추적용 `legacyFile` 필드를 추가했습니다.

### 이미지 경로 전략

레거시 `image/` 폴더는 **복사·이동하지 않습니다**. 대신:

1. **추출 스크립트**가 참조 이미지를 `public/assets/works/legacy/`로 복사
   (재생성 가능 → `.gitignore`, 미커밋).
2. **검수된 12개**의 이미지만 `public/assets/works/web/`로 복사해 **커밋**.
   사이트는 스크립트 실행 없이도 이 12개 이미지로 정상 동작합니다.
3. 깨진 이미지 방지: `WorkGrid`/`WorkDetail`의 `<img>`에 `onerror` 처리.
   이미지 로드 실패 시 회색 placeholder 박스로 폴백합니다.

이미지 최적화(리사이즈/압축)는 아직 미적용입니다. `public/assets/works/web/`의 원본을
그대로 사용하며, `scripts/build-images.mjs`(sharp 기반)로 `web/`·`thumb/` 생성하는 것은
이후 단계입니다.

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
npm run check            # astro check — 0 errors
npm run build            # 정적 빌드 — 22 pages
```

빌드 결과(`dist/`)에서 확인한 사항:

- woff2 폰트 번들 (Geist Sans/Mono + Pretendard Variable 한글 서브셋)
- 작품 상세/그리드 페이지 12개 생성, 한글 제목·연도·매체 정상 표기
- `현재 12점` 카운트가 실제 데이터 기준으로 렌더
- 커밋된 `web/` 이미지가 상대경로로 정상 해석 (깨진 이미지 없음)
