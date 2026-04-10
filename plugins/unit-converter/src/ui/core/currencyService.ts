export type CurrencyRatePayload = {
  base: string
  rates: Record<string, number>
  currencies: Record<string, string>
  updatedAt: number
}

const LATEST_ENDPOINT = 'https://api.frankfurter.dev/v1/latest?from=USD'
const CURRENCIES_ENDPOINT = 'https://api.frankfurter.dev/v1/currencies'

export async function fetchRatesViaHttp(
  httpGet: (url: string, headers?: Record<string, string>) => Promise<{ status: number; data: string } | undefined>
): Promise<CurrencyRatePayload> {
  const [latestResponse, currenciesResponse] = await Promise.all([httpGet(LATEST_ENDPOINT), httpGet(CURRENCIES_ENDPOINT)])
  if (!latestResponse || latestResponse.status < 200 || latestResponse.status >= 300) {
    throw new Error('汇率接口请求失败')
  }
  if (!currenciesResponse || currenciesResponse.status < 200 || currenciesResponse.status >= 300) {
    throw new Error('币种列表请求失败')
  }

  const parsed = JSON.parse(latestResponse.data) as { base?: string; date?: string; rates?: Record<string, number> }
  const parsedCurrencies = JSON.parse(currenciesResponse.data) as Record<string, string>
  if (!parsed.base || !parsed.rates || Object.keys(parsed.rates).length === 0) {
    throw new Error('汇率接口返回异常')
  }
  if (!parsedCurrencies || Object.keys(parsedCurrencies).length === 0) {
    throw new Error('币种列表返回异常')
  }

  const base = parsed.base.toUpperCase()
  const rates = {
    ...parsed.rates,
    [base]: 1
  }

  return {
    base,
    rates,
    currencies: parsedCurrencies,
    updatedAt: Date.now()
  }
}

export function convertCurrency(value: number, fromUnit: string, toUnit: string, rates: Record<string, number>): number {
  const fromRate = rates[fromUnit]
  const toRate = rates[toUnit]
  if (!fromRate || !toRate) {
    throw new Error('汇率数据不完整')
  }
  const usdValue = value / fromRate
  return usdValue * toRate
}
