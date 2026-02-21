export type {
  SessionState,
  SymbolStatus,
  OrderSide,
  EventType,
  SessionStartRequest,
  SessionStartResponse,
  SessionStopResponse,
  SessionStatusResponse,
  Counts,
  Cooldown,
  SymbolRow,
  EventRow,
  HelloMessage,
  SnapshotMessage,
  TickMessage,
  EventsAppendMessage,
  SessionStateMessage,
  ErrorMessage,
} from '../api/dto';

export const WS_ERROR_CODES = {
  RECONNECTING: 'RECONNECTING',
  BYBIT_WS_ERROR: 'BYBIT_WS_ERROR',
  PAYLOAD_TOO_LARGE_DELTA_MODE: 'PAYLOAD_TOO_LARGE_DELTA_MODE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  STATUS_ORDER_WITH_POSITION: 'STATUS_ORDER_WITH_POSITION',
  STATUS_POSITION_MISSING: 'STATUS_POSITION_MISSING',
  ORDER_EXPIRY_BEFORE_PLACED: 'ORDER_EXPIRY_BEFORE_PLACED',
  ORDER_QTY_INVALID: 'ORDER_QTY_INVALID',
  POSITION_QTY_INVALID: 'POSITION_QTY_INVALID',
  POSITION_LONG_TP_SL_INVALID: 'POSITION_LONG_TP_SL_INVALID',
  POSITION_SHORT_TP_SL_INVALID: 'POSITION_SHORT_TP_SL_INVALID',
  QUEUE_OVERFLOW: 'QUEUE_OVERFLOW',
} as const;

export type WsErrorCode = (typeof WS_ERROR_CODES)[keyof typeof WS_ERROR_CODES];
