export type EntrypointParamKind = 'positional' | 'keyword_only' | 'varargs' | 'varkw'

export type EntrypointParamType = 'string' | 'int' | 'float' | 'bool' | 'dict' | 'list' | 'any' | 'varargs' | 'varkw'

export interface EntrypointParameter {
  name: string
  annotation?: string
  type: EntrypointParamType
  required: boolean
  default?: unknown
  kind: EntrypointParamKind
}
