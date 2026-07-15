export function FilterPanelShell({ amount }: { amount: number }) {
  return (
    <form action="" method="get">
      <label>
        Tutar
        <input type="number" name="amount" defaultValue={amount} step={5000} />
      </label>
      <button type="submit">Filtrele</button>
    </form>
  );
}
