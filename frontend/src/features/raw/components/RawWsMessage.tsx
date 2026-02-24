type Props = {
  value: string;
};

export function RawWsMessage({ value }: Props) {
  return (
    <details className="mt-2" style={{ maxWidth: "100%" }}>
      <summary>Last WS message (raw)</summary>
      <div style={{ maxWidth: "100%", overflowX: "auto" }}>
        <pre
          style={{
            margin: 0,
            maxWidth: "100%",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowWrap: "anywhere"
          }}
        >
          {value}
        </pre>
      </div>
    </details>
  );
}
