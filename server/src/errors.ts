// Error de negocio con status HTTP. Los servicios lo lanzan y el manejador global
// lo traduce a JSON sin exponer stack traces al cliente.
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}
