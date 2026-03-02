import { ProgressBar } from "react-bootstrap";

type CenteredProgressBarProps = {
  now: number;
  label: string;
  title?: string;
  className?: string;
};

export function CenteredProgressBar({ now, label, title, className }: CenteredProgressBarProps) {
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
        {label}
      </div>
    </div>
  );
}
