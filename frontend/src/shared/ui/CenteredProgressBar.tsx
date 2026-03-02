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
      <ProgressBar now={roundedNow} label="" />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          fontSize: 12,
        }}
      >
        {display}
      </div>
    </div>
  );
}
