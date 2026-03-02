import { ProgressBar } from "react-bootstrap";

type CenteredProgressBarProps = {
  now: number;
  label?: string;
  showPercent?: boolean;
  title?: string;
  className?: string;
};

export function CenteredProgressBar({ now, label, showPercent = false, title, className }: CenteredProgressBarProps) {
  const roundedNow = Math.round(Math.max(0, Math.min(100, now)));
  const display = label ?? (showPercent ? `${roundedNow}%` : "");
  return (
    <div className={className} style={{ position: "relative" }} title={title}>
      <ProgressBar now={now} label="" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          fontSize: 12,
        }}
      >
        {display}
      </div>
    </div>
  );
}
