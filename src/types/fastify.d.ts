import "@fastify/jwt";

declare module "fastify" {
  interface FastifyInstance {
    jwt: {
      sign(payload: { userId: unknown }, options?: any): string;
      verify<T>(token: string, options?: any): T;
    };
  }
}