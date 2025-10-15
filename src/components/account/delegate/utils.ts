import { getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export async function getTokenDecimals (mintAddress: PublicKey): Promise<number> {
  try {
    // Usamos getMint de la librería SPL-Token
    const mintInfo = await getMint(connection, mintAddress);

    // El campo 'decimals' contiene el número que necesitas (ej. 6 para USDC)
    const decimals = mintInfo.decimals;

    console.log(`El token ${mintAddress.toBase58()} tiene ${decimals} decimales.`);
    return decimals;

  } catch (error) {
    console.error("Error al obtener la información del Mint:", error);
    throw new Error("No se pudo obtener la información del Token Mint.");
  }
}

/**
 * Helper para convertir cantidad a bigint (esperando tokens con 0..n decimales,
 */
export function toBigIntAmount (amount: number | bigint | string): bigint {
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number") return BigInt(Math.floor(amount));
  // string -> parseInt (evitar floats en string)
  return BigInt(Number.parseInt(amount, 10));
}