import type { SVGProps } from "react";

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" {...props}>
      <rect x="1" y="1" width="12" height="8" rx="2" fill="none" stroke="var(--step)" strokeWidth="2" />
      <path d="M7 9v5" stroke="var(--wire)" strokeWidth="2" />
      <rect x="7" y="14" width="8" height="8" rx="1.5" transform="rotate(45 7 18)" fill="var(--decide)" />
      <path d="M12 18h6M7 23v4" stroke="var(--wire)" strokeWidth="2" />
      <rect x="17" y="14" width="12" height="8" rx="2" fill="none" stroke="var(--loop)" strokeWidth="2" />
    </svg>
  );
}

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" {...props}>
      <path d="M8 1l7 6v8h-4v-5H5v5H1V7z" />
    </svg>
  );
}

export function SkillFlowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <rect x="1" y="2" width="6" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 7v3M7 8.5h4" stroke="currentColor" strokeWidth="1.6" />
      <rect x="9" y="6" width="6" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function ProjectFlowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path d="M2 3h12v10H2zM2 6h12M5 3v10" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function GitHubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function UploadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path
        d="M8 11V2M4 6l4-4 4 4M2 14h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="13" viewBox="0 0 16 14" aria-hidden="true" {...props}>
      <path
        d="M1 2.5h4.5l1.5 1.8H15V12.5H1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path
        d="M8 2v9M4 7l4 4 4-4M2 14h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LoopIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path
        d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true" {...props}>
      <path d="M1 1h5l3 3v6H1z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
