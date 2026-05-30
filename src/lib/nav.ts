import { WORK_SERIES } from "../content/config";

export interface NavItem {
  label: string;
  href: string;
}

/** Primary header navigation, in Figma order. */
export const MAIN_NAV: NavItem[] = [
  { label: "WORKS", href: "/works/" },
  { label: "EXHIBITION", href: "/exhibition/" },
  { label: "ESSAY", href: "/essay/" },
  { label: "C.V.", href: "/cv/" },
  { label: "CONTACT", href: "/contact/" },
];

/** Works sub-categories (dropdown / category nav). */
export const WORK_CATEGORIES: { label: string; series: (typeof WORK_SERIES)[number]; href: string }[] = [
  { label: "BLIND WORK", series: "blind-work", href: "/works/blind-work/" },
  { label: "INSTALLATION WORK", series: "installation-work", href: "/works/installation-work/" },
  { label: "MULTI SLIDE PROJECTION", series: "multi-slide-projection", href: "/works/multi-slide-projection/" },
  { label: "PAINTINGS", series: "paintings", href: "/works/paintings/" },
];

export const LOGO_LABEL = "KONG,SUNG-HUN";
