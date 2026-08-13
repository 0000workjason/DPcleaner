import { useState } from "react";
import { imgUrl } from "../api";
import { useT } from "../i18n";

interface Props {
  path: string;
  size?: number;
  alt?: string;
  onClick?: () => void;
  className?: string;
  /** Changes when the file behind `path` changes, so the webview's URL-keyed
   *  HTTP cache can't serve a stale image after a rename. */
  version?: string | number;
}

/** A lazily-loaded JPEG thumbnail served by the backend. */
export function Thumb({
  path,
  size = 320,
  alt,
  onClick,
  className,
  version,
}: Props) {
  const t = useT();
  const [err, setErr] = useState(false);
  if (err)
    return (
      <div className={`thumb-fallback ${className || ""}`}>
        {t("thumb.fallback")}
      </div>
    );
  return (
    <img
      className={`thumb ${className || ""}`}
      src={imgUrl(path, size, "thumb", version)}
      alt={alt || path}
      loading="lazy"
      draggable={false}
      onError={() => setErr(true)}
      onClick={onClick}
    />
  );
}
