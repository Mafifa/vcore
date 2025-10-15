// transfer-delegated.ts
import * as spl from "@solana/spl-token";
import {
  Transaction,
  Connection,
  PublicKey,
  Keypair,
  SendOptions,
  Commitment,
} from "@solana/web3.js";

/** TIP: importa el secret key desde process.env (ver recomendaciones abajo) */
function loadDelegateKeypairFromEnv (): Keypair {
  const raw = [
    23, 239, 170, 94, 156, 235, 148, 52, 64, 137, 70,
    31, 197, 251, 254, 152, 67, 119, 241, 249, 157, 117,
    192, 0, 183, 135, 114, 89, 198, 30, 99, 116, 157,
    219, 63, 164, 179, 82, 197, 201, 127, 42, 29, 98,
    117, 103, 52, 16, 236, 166, 227, 97, 154, 206, 38,
    116, 125, 151, 101, 215, 125, 104, 153, 102
  ];

  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

interface DelegateTransferParams {
  connection: Connection;
  sourceTokenAccount: PublicKey; // La ATA del usuario
  destinationTokenAccount: PublicKey; // ATA destino
  tokenMintAddress: PublicKey;
  amount: bigint; // ahora forcemos bigint (unidades mínimas)
  decimals: number;
  delegateKeypair?: Keypair; // opcionalmente inyectar (útil para tests)
  sendOptions?: SendOptions;
  confirmation?: Commitment;
}

/**
 * transferDelegatedTokens: realiza la transferencia usando la autoridad delegada.
 * - Valida: existencia de cuentas, que el mint coincida, que el delegate sea el delegado autorizado,
 *   y que el allowance >= amount.
 */
export async function transferDelegatedTokens ({
  connection,
  sourceTokenAccount,
  destinationTokenAccount,
  tokenMintAddress,
  amount,
  decimals,
  delegateKeypair,
  sendOptions,
  confirmation = "confirmed",
}: DelegateTransferParams): Promise<string> {
  // Cargar Keypair del delegado (desde la inyección o desde env)
  const delegate = delegateKeypair ?? loadDelegateKeypairFromEnv();
  const delegatePubkey = delegate.publicKey;

  // --- VALIDACIONES PREVIAS (evitan errores on-chain y gasto de fees)
  // 1) Obtener info de la cuenta token fuente (parsed)
  const parsed = await connection.getParsedAccountInfo(sourceTokenAccount, confirmation);
  if (!parsed.value) throw new Error("Cuenta de token fuente no encontrada en la RPC.");

  const parsedData = (parsed.value.data as any).parsed?.info;
  if (!parsedData) throw new Error("No se pudo parsear la cuenta fuente (expected parsed token account).");

  // Verificar mint de la cuenta fuente
  const sourceMintStr = parsedData.mint as string;
  if (new PublicKey(sourceMintStr).toBase58() !== tokenMintAddress.toBase58()) {
    throw new Error("El mint de la cuenta fuente no coincide con tokenMintAddress.");
  }

  // Verificar delegate y delegatedAmount (si existe)
  const delegateField = parsedData.delegate; // puede ser null o pubkey str
  const delegatedAmountStr = parsedData.delegatedAmount?.amount ?? "0"; // string en unidades mínimas

  if (!delegateField) {
    throw new Error("No existe un delegado autorizado en la cuenta fuente.");
  }
  if (delegateField !== delegatePubkey.toBase58()) {
    throw new Error(
      `El delegado autorizado (${delegateField}) no coincide con la clave del servidor (${delegatePubkey.toBase58()}).`
    );
  }

  const delegatedAmount = BigInt(delegatedAmountStr);
  if (delegatedAmount < amount) {
    throw new Error(
      `Allowance insuficiente: delegatedAmount=${delegatedAmountStr}, requerido=${amount.toString()}`
    );
  }

  // 2) Verificar que la cuenta destino exista y tenga el mismo mint (opcional: crear ATA si hace falta)
  const destParsed = await connection.getParsedAccountInfo(destinationTokenAccount, confirmation);
  if (!destParsed.value) {
    throw new Error("Cuenta de token destino no encontrada. Asegúrate de que la ATA destino existe.");
  }
  const destParsedInfo = (destParsed.value.data as any).parsed?.info;
  if (!destParsedInfo) throw new Error("No se pudo parsear la cuenta destino.");

  if (new PublicKey(destParsedInfo.mint).toBase58() !== tokenMintAddress.toBase58()) {
    throw new Error("El mint de la cuenta destino no coincide con tokenMintAddress.");
  }

  // --- Construcción de la instrucción (TransferChecked)
  // createTransferCheckedInstruction(
  //   source: PublicKey,
  //   mint: PublicKey,
  //   destination: PublicKey,
  //   owner: PublicKey, // authority (delegate)
  //   amount: number|bigint,
  //   decimals: number,
  //   multiSigners?: (PublicKey | Signer)[],
  //   programId?: PublicKey
  // )
  const transferIx = spl.createTransferCheckedInstruction(
    sourceTokenAccount,
    tokenMintAddress,
    destinationTokenAccount,
    delegatePubkey, // authority (delegate)
    amount,
    decimals,
    [],
    spl.TOKEN_PROGRAM_ID
  );

  // Preparar tx
  const tx = new Transaction().add(transferIx);
  tx.feePayer = delegatePubkey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(confirmation);
  tx.recentBlockhash = blockhash;

  // Firmar con la clave privada del delegado
  tx.sign(delegate);

  const raw = tx.serialize();

  const txid = await connection.sendRawTransaction(raw, sendOptions);
  await connection.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, confirmation);

  return txid;
}

/**
 * handleTransferRequest: handler simple que espera un body con:
 * { sourceTokenAccountStr, tokenMintAddressStr, amount, decimals, rpcEndpoint }
 *
 * - amount: puede ser string con unidades mínimas (ej "123456") o bigint/number.
 * - Retorna { success: true, idCompletado } o { success: false, error } para que el frontend actúe.
 */
export async function handleTransferRequest (requestBody: any): Promise<any> {
  const {
    sourceTokenAccountStr,
    tokenMintAddressStr,
    amount: amountIn,
    decimals,
    rpcEndpoint,
  } = requestBody;

  // DESTINO (no hardcodear en producción; usar env o DB)
  const destinationTokenAccountStr = process.env.CEX_VAULT_ATA ?? "";

  if (!destinationTokenAccountStr) {
    return { success: false, error: "DESTINO no configurado en servidor (CEX_VAULT_ATA)." };
  }

  try {
    const connection = new Connection(rpcEndpoint, "confirmed");
    const sourceTokenAccount = new PublicKey(sourceTokenAccountStr);
    const destinationTokenAccount = new PublicKey(destinationTokenAccountStr);
    const tokenMintAddress = new PublicKey(tokenMintAddressStr);

    // Normalizar amount a bigint (si viene como string)
    let amount: bigint;
    if (typeof amountIn === "string") {
      // esperar que venga en unidades mínimas (raw)
      amount = BigInt(amountIn);
    } else if (typeof amountIn === "number") {
      // si viene number asumimos que es raw (poco recomendable)
      amount = BigInt(Math.floor(amountIn));
    } else if (typeof amountIn === "bigint") {
      amount = amountIn;
    } else {
      return { success: false, error: "Amount inválido en requestBody" };
    }

    const txid = await transferDelegatedTokens({
      connection,
      sourceTokenAccount,
      destinationTokenAccount,
      tokenMintAddress,
      amount,
      decimals: Number(decimals),
      // delegateKeypair: opcional, si quieres inyectar para tests
      sendOptions: { skipPreflight: false },
      confirmation: "confirmed",
    });

    // Para mantener compatibilidad con el frontend que espera idCompletado
    return { success: true, idCompletado: txid };
  } catch (error: any) {
    console.error("API Error:", error);
    return { success: false, error: String(error?.message ?? error) };
  }
}
