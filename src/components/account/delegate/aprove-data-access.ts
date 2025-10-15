import bs58 from "bs58";
import { TOKEN_PROGRAM_ID, createApproveInstruction } from "@solana/spl-token";
import { Connection, PublicKey, Transaction, SendOptions, Commitment, TransactionSignature, Signer } from "@solana/web3.js";
import { detectAccountOwnerProgram } from "./detect-token-program";
import { toBigIntAmount } from "./utils";

export type AtasWithAmount = {
  ata: string;
  mint: string;
  amountRawStr: string;
  amountUi: number;
}

export type ApproveResult = {
  txid: TransactionSignature;
  approvals: {
    ownerAta: string;
    mint: string;
    programId: string;
    amount: string
  }[];
}

/**
 * approveTokenAllowances
 * - connection: RPC connection
 * - ownerPublicKey: PublicKey del propietario de las ATAs (firma requerida)
 * - signTransaction: función para firmar la transacción (wallet.signTransaction)
 * - cexDelegateAddress: PublicKey que recibirá la allowance (delegate)
 * - atasWithAmount: lista de ATAs + cantidad a aprobar
 *
 * Nota: por simplicidad aquí agrupo todas las approvals en una sola transacción.
 */
export async function approveTokenAllowances (params: {
  connection: Connection;
  ownerPublicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  cexDelegateAddress: PublicKey;
  atasWithAmount: AtasWithAmount[];
  confirmation?: SendOptions | Commitment;
}): Promise<ApproveResult> {
  const {
    connection,
    ownerPublicKey,
    signTransaction,
    cexDelegateAddress,
    atasWithAmount,
    confirmation,
  } = params;

  if (!atasWithAmount || atasWithAmount.length === 0) {
    throw new Error("atasWithAmount is empty");
  }

  const commitment = (typeof confirmation === "string" ? (confirmation as Commitment) : undefined) ?? undefined;

  const tx = new Transaction();

  tx.feePayer = ownerPublicKey;

  // Guardar metadata de approvals para retornar
  const approvals: { ownerAta: string; mint: string; programId: string, amount: string }[] = [];

  // Para cada ATA: detectamos ownerProgram y añadimos la instrucción approve correspondiente
  for (const entry of atasWithAmount) {
    const ataPub = typeof entry.ata === "string" ? new PublicKey(entry.ata) : entry.ata;
    const amountBigInt = toBigIntAmount(entry.amountRawStr);

    // Detectar owner program de la cuenta (puede ser Token o Token-2022 u otro)
    const progInfo = await detectAccountOwnerProgram(connection, ataPub, commitment);

    // crear approve instruction indicando explícitamente el programId detectado
    let programId: PublicKey;
    try {
      programId = new PublicKey(progInfo.ownerProgramId);
    } catch (err) {
      // fallback a TOKEN_PROGRAM_ID si algo raro sucede
      console.log('error desde approveTokenAllowances', err?.message ?? err);
      programId = TOKEN_PROGRAM_ID;
    }

    const approveIx = createApproveInstruction(
      ataPub,
      cexDelegateAddress,
      ownerPublicKey,
      amountBigInt,
      [] as Signer[],
      programId
    );

    tx.add(approveIx);

    approvals.push({
      ownerAta: ataPub.toBase58(),
      mint: entry.mint,
      programId: programId.toBase58(),
      amount: entry.amountRawStr
    });
  }

  // obtener blockhash reciente y setear en tx
  const latest = await connection.getLatestBlockhash(
    typeof confirmation === "string" ? (confirmation as Commitment) : undefined
  );
  tx.recentBlockhash = latest.blockhash;

  // firmar por el wallet
  const signedTx = await signTransaction(tx);

  // helper: extraer la firma (txid) desde la transaction firmada (primer signature no nula)
  function getSignatureBase58FromSignedTx (signed: Transaction): string | null {
    const sigPair = signed.signatures.find((s) => s.signature && s.signature.length > 0);
    if (!sigPair) return null;
    return bs58.encode(sigPair.signature!);
  }

  // enviar raw transaction con manejo de "already been processed"
  const raw = signedTx.serialize();
  let txid: TransactionSignature | undefined;
  try {
    txid = await connection.sendRawTransaction(raw, typeof confirmation === "object" ? confirmation : undefined);
  } catch (err: any) {
    // Si el RPC indica 'already been processed', intentamos recuperar la firma desde la tx firmada
    const msg = err?.message ?? String(err);
    console.error("sendRawTransaction error:", msg);

    if (msg.includes("already been processed") || msg.includes("Transaction already processed")) {
      const maybeTxid = getSignatureBase58FromSignedTx(signedTx);
      if (maybeTxid) {
        // comprobar si la transacción existe en la cadena: si existe, devolverla como resultado exitoso
        try {
          const txInfo = await connection.getTransaction(maybeTxid, { commitment: 'confirmed' });
          if (txInfo) {
            console.log("Tx ya estaba procesada en la cadena; retornando como éxito:", maybeTxid);
            return { txid: maybeTxid, approvals };
          }
          // si no hay info, intenta también getSignatureStatuses
          const status = await connection.getSignatureStatuses([maybeTxid]);
          if (status && status.value && status.value[0] && status.value[0].confirmationStatus) {
            console.log("SignatureStatuses indica que tx fue procesada:", maybeTxid);
            return { txid: maybeTxid, approvals };
          }
        } catch (e) {
          console.warn("Error consultando la tx ya procesada:", e);
          // Caerá al throw de abajo si no podemos confirmar que fue procesada
        }
      }
    }

    // Si el error es de tipo SendTransactionError y tiene getLogs(), registrar logs para debug
    if (typeof err?.getLogs === "function") {
      try {
        const logs = await err.getLogs();
        console.error("SendTransactionError logs:", logs);
      } catch (e) {
        // ignore
      }
    }

    throw err;
  }

  // confirmar la transacción normalmente
  const confirmationResult = await connection.confirmTransaction(
    {
      signature: txid!,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight
    },
    'confirmed'
  );

  if (confirmationResult.value.err) {
    throw new Error(`Transaction failed: ${confirmationResult.value.err}`);
  }

  return { txid: txid!, approvals };
}