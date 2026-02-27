import { Button } from "react-bootstrap";

type Props = {
  value: string;
  label?: string;
  className?: string;
};

export function CopyButton({ value, label = "copy", className }: Props) {
  return (
    <Button
      size="sm"
      variant="outline-secondary"
      className={className}
      onClick={() => {
        try {
          void navigator.clipboard.writeText(value);
        } catch {
          // ignore
        }
      }}
    >
      {label}
    </Button>
  );
}
