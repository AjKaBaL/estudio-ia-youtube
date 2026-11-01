/**
 * Fontes de pesquisa que já vêm cadastradas em todo projeto novo (e uma vez nos projetos existentes).
 * Todas são feeds públicos conferidos em 31/10/2026: responderam com um feed válido e itens recentes.
 * O usuário pode desativar, remover ou restaurar qualquer uma em Pautas e pesquisas › Fontes.
 */

export interface FontePadrao {
  nome: string
  url: string
  grupo: 'Brasil' | 'IA' | 'Tecnologia e negócios' | 'Agregadores' | 'Europa' | 'Estados Unidos' | 'Japão'
}

/**
 * Veículos reconhecidos do Brasil, da Europa, dos Estados Unidos e do Japão (feeds conferidos em 01/11/2026).
 * Entram uma vez também nos projetos que já existiam antes deles.
 */
export const FONTES_INTERNACIONAIS: readonly FontePadrao[] = [
  { grupo: 'Brasil', nome: 'g1 — Tecnologia', url: 'https://g1.globo.com/rss/g1/tecnologia/' },
  { grupo: 'Brasil', nome: 'Folha — Tecnologia', url: 'https://feeds.folha.uol.com.br/tec/rss091.xml' },
  { grupo: 'Brasil', nome: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml' },
  { grupo: 'Brasil', nome: 'BBC News Brasil', url: 'https://feeds.bbci.co.uk/portuguese/rss.xml' },
  { grupo: 'Europa', nome: 'BBC — Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { grupo: 'Europa', nome: 'The Guardian — Technology', url: 'https://www.theguardian.com/technology/rss' },
  { grupo: 'Europa', nome: 'Financial Times — Technology', url: 'https://www.ft.com/technology?format=rss' },
  { grupo: 'Europa', nome: 'The Economist — Science and technology', url: 'https://www.economist.com/science-and-technology/rss.xml' },
  { grupo: 'Europa', nome: 'Nature', url: 'https://www.nature.com/nature.rss' },
  { grupo: 'Europa', nome: 'The Register', url: 'https://www.theregister.com/headlines.atom' },
  { grupo: 'Europa', nome: 'heise online', url: 'https://www.heise.de/rss/heise-atom.xml' },
  { grupo: 'Europa', nome: 'Le Monde — Pixels', url: 'https://www.lemonde.fr/pixels/rss_full.xml' },
  { grupo: 'Europa', nome: 'El País — Tecnología', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/tecnologia/portada' },
  { grupo: 'Estados Unidos', nome: 'The New York Times — Technology', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml' },
  { grupo: 'Estados Unidos', nome: 'NPR — Technology', url: 'https://feeds.npr.org/1019/rss.xml' },
  { grupo: 'Estados Unidos', nome: 'CNBC — Technology', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html' },
  { grupo: 'Estados Unidos', nome: 'Engadget', url: 'https://www.engadget.com/rss.xml' },
  { grupo: 'Estados Unidos', nome: 'NIST — notícias', url: 'https://www.nist.gov/news-events/news/rss.xml' },
  { grupo: 'Japão', nome: 'The Japan Times', url: 'https://www.japantimes.co.jp/feed/' },
  { grupo: 'Japão', nome: 'Nikkei Asia', url: 'https://asia.nikkei.com/rss/feed/nar' },
  { grupo: 'Japão', nome: 'ITmedia AI+', url: 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml' },
  { grupo: 'Japão', nome: 'Japan Today — Tech', url: 'https://japantoday.com/category/tech/feed' }
]

/**
 * Veículos reconhecidos (domínio principal): quando um deles aparece nas pesquisas e tem feed, entra sozinho como
 * fonte, sem esperar aprovação. Os demais sites continuam como sugestão para o usuário aprovar.
 */
export const DOMINIOS_RECONHECIDOS: readonly string[] = [
  // Brasil
  'globo.com', 'uol.com.br', 'estadao.com.br', 'cnnbrasil.com.br', 'ebc.com.br', 'gov.br', 'fapesp.br', 'usp.br', 'unicamp.br',
  'terra.com.br', 'poder360.com.br', 'abril.com.br', 'exame.com', 'infomoney.com.br', 'nexojornal.com.br', 'jota.info',
  'correiobraziliense.com.br', 'tecnoblog.net', 'tecmundo.com.br', 'olhardigital.com.br', 'canaltech.com.br',
  // Europa
  'bbc.co.uk', 'bbc.com', 'theguardian.com', 'ft.com', 'economist.com', 'reuters.com', 'nature.com', 'newscientist.com', 'theregister.com',
  'heise.de', 'spiegel.de', 'dw.com', 'lemonde.fr', 'lesechos.fr', 'elpais.com', 'publico.pt', 'rtp.pt', 'euronews.com', 'europa.eu',
  'politico.eu', 'sifted.eu',
  // Estados Unidos
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'apnews.com', 'npr.org', 'cnbc.com', 'bloomberg.com', 'axios.com', 'cnn.com',
  'theverge.com', 'wired.com', 'arstechnica.com', 'techcrunch.com', 'engadget.com', 'technologyreview.com', 'scientificamerican.com',
  'science.org', 'ieee.org', 'nist.gov', 'mit.edu', 'stanford.edu',
  // Japão
  'japantimes.co.jp', 'nikkei.com', 'itmedia.co.jp', 'japantoday.com', 'nhk.or.jp', 'kyodonews.net', 'asahi.com', 'mainichi.jp',
  'yomiuri.co.jp', 'nippon.com', 'impress.co.jp', 'riken.jp'
]

export const dominioReconhecido = (dominio: string): boolean => {
  const d = dominio.toLowerCase().replace(/^www\./, '')
  return DOMINIOS_RECONHECIDOS.some((r) => d === r || d.endsWith(`.${r}`))
}

export const FONTES_PADRAO: readonly FontePadrao[] = [
  // Brasil: tecnologia, negócios e startups
  { grupo: 'Brasil', nome: 'Tecnoblog', url: 'https://tecnoblog.net/feed/' },
  { grupo: 'Brasil', nome: 'Canaltech', url: 'https://canaltech.com.br/rss/' },
  { grupo: 'Brasil', nome: 'Olhar Digital', url: 'https://olhardigital.com.br/feed/' },
  { grupo: 'Brasil', nome: 'Tecmundo', url: 'https://rss.tecmundo.com.br/feed' },
  { grupo: 'Brasil', nome: 'Exame', url: 'https://exame.com/feed/' },
  { grupo: 'Brasil', nome: 'InfoMoney', url: 'https://www.infomoney.com.br/feed/' },
  { grupo: 'Brasil', nome: 'NeoFeed', url: 'https://neofeed.com.br/feed/' },
  { grupo: 'Brasil', nome: 'Startups.com.br', url: 'https://startups.com.br/feed/' },
  { grupo: 'Brasil', nome: 'Convergência Digital', url: 'https://www.convergenciadigital.com.br/feed/' },
  { grupo: 'Brasil', nome: 'Baguete', url: 'https://www.baguete.com.br/rss' },
  // Inteligência artificial: fontes primárias (laboratórios e empresas) e jornalismo especializado
  { grupo: 'IA', nome: 'OpenAI — notícias', url: 'https://openai.com/news/rss.xml' },
  { grupo: 'IA', nome: 'Google — blog de IA', url: 'https://blog.google/technology/ai/rss/' },
  { grupo: 'IA', nome: 'Google DeepMind — blog', url: 'https://deepmind.google/blog/rss.xml' },
  { grupo: 'IA', nome: 'Hugging Face — blog', url: 'https://huggingface.co/blog/feed.xml' },
  { grupo: 'IA', nome: 'NVIDIA — blog', url: 'https://blogs.nvidia.com/feed/' },
  { grupo: 'IA', nome: 'AWS — Machine Learning', url: 'https://aws.amazon.com/blogs/machine-learning/feed/' },
  { grupo: 'IA', nome: 'MIT News — inteligência artificial', url: 'https://news.mit.edu/rss/topic/artificial-intelligence2' },
  { grupo: 'IA', nome: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
  // Tecnologia e negócios da inovação (internacional)
  { grupo: 'Tecnologia e negócios', nome: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { grupo: 'Tecnologia e negócios', nome: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { grupo: 'Tecnologia e negócios', nome: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { grupo: 'Tecnologia e negócios', nome: 'Wired', url: 'https://www.wired.com/feed/rss' },
  { grupo: 'Tecnologia e negócios', nome: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/feed.rss' },
  { grupo: 'Tecnologia e negócios', nome: 'Sifted (startups europeias)', url: 'https://sifted.eu/feed' },
  { grupo: 'Tecnologia e negócios', nome: 'GitHub — blog', url: 'https://github.blog/feed/' },
  // Agregadores: trazem links de muitos sites e alimentam as sugestões de novas fontes
  { grupo: 'Agregadores', nome: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  {
    grupo: 'Agregadores',
    nome: 'Google Notícias — inteligência artificial',
    url: 'https://news.google.com/rss/search?q=intelig%C3%AAncia+artificial&hl=pt-BR&gl=BR&ceid=BR:pt-419'
  },
  ...FONTES_INTERNACIONAIS
]

/**
 * Termos monitorados iniciais (pesquisas agendadas). Vírgula = alternativa; palavras dentro de um termo
 * precisam aparecer juntas. Evita siglas curtas ("IA", "AI", "Meta") que casariam com outras palavras.
 */
export const TERMOS_PADRAO: readonly string[] = [
  'inteligência artificial',
  'artificial intelligence',
  'IA generativa',
  'generative AI',
  'OpenAI',
  'ChatGPT',
  'Gemini',
  'Anthropic',
  'LLM',
  'machine learning',
  'aprendizado de máquina',
  'Nvidia',
  'semicondutor',
  'semiconductor',
  'chip',
  'startup',
  'venture capital',
  'robótica',
  'robot',
  'quantum',
  'quântica',
  'cibersegurança',
  'cybersecurity',
  'big tech'
]
