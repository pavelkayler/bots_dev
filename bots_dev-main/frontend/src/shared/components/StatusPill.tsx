import { Badge } from "react-bootstrap";

type Props = {
  variant: string;
  text: string;
};

export function StatusPill({ variant, text }: Props) {
  return <Badge bg={variant as any}>{text}</Badge>;
}
