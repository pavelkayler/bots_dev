import { ProgressBar } from "react-bootstrap";

type CenteredProgressBarProps = {
  now: number;
  label?: string;
  showPercent?: boolean;
  precision?: number;
  title?: string;
  className?: string;
};

export function CenteredProgressBar({ now, label, showPercent = false, precision = 1, title, className }: CenteredProgressBarProps) {
  const display = label ?? (showPercent ? `${Math.max(0, Math.min(100, now)).toFixed(precision)}%` : "");
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
