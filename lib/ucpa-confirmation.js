const FREE_CANCELLATION = 'En confirmant l’annulation, tu n’auras rien à payer, les autres joueurs non plus.'

export const inspectUcpaCancellationDialog = async page => {
  const title = page.getByText('Tu es sur le point d\'annuler la partie.', { exact: true })
  await title.waitFor()
  const free = page.getByText(FREE_CANCELLATION, { exact: false })
  await free.waitFor()
  const terms = (await free.innerText()).trim()
  if (!terms.includes(FREE_CANCELLATION)) throw new Error('UCPA free cancellation is not confirmed')
  const submit = page.getByRole('button', { name: 'Confirmer l\'annulation', exact: true })
  await submit.waitFor()
  await page.getByRole('button', { name: 'Garder ma partie', exact: true }).waitFor()
  return { terms, feeEUR: 0, submit }
}

// The caller verifies the reservation and records the intent before this single click.
export const clickUcpaCancellation = async (page, beforeSubmit) => {
  const { submit, terms } = await inspectUcpaCancellationDialog(page)
  if (typeof beforeSubmit !== 'function') throw new Error('UCPA cancellation journal is required')
  await beforeSubmit({ terms, feeEUR: 0 })
  await submit.click()
}
