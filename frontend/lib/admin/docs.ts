export type DocMeta = { slug: string; title: string; description: string; group: string };

export const DOCS: DocMeta[] = [
  {
    slug: "watermark-model",
    group: "Фото",
    title: "Водяной знак поставщика",
    description: "Как знак наложен на фото и почему его можно снять точно, а не замазать: модель смешивания, размеры, слои, JPEG.",
  },
  {
    slug: "watermark-detection",
    group: "Фото",
    title: "Поиск знака",
    description: "Согласованный фильтр по градиентам, корреляция и сила знака k, правила, по которым кандидат принимается.",
  },
  {
    slug: "watermark-removal",
    group: "Фото",
    title: "Снятие знака",
    description: "Обращение смешивания для нескольких слоёв, подбор цвета робастными наименьшими квадратами, яркость и цветность.",
  },
  {
    slug: "watermark-calibration",
    group: "Фото",
    title: "Калибровка шаблонов",
    description: "Как из сотен фото поставщика получается прозрачность знака в каждой точке и как её пересчитать.",
  },
  {
    slug: "image-pipeline",
    group: "Фото",
    title: "Конвейер обработки фото",
    description: "Очередь, приоритеты, лимиты поставщика, статусы, версии файлов и обработка на лету.",
  },
  {
    slug: "pricing",
    group: "Цены",
    title: "Как считается цена",
    description: "Наценка по категориям, минимальная наценка, РРЦ, округление и фиксированные цены — по шагам и с примером.",
  },
  {
    slug: "sync",
    group: "Каталог",
    title: "Синхронизация с поставщиком",
    description: "Какие данные и как часто забираются у поставщика, как воркер укладывается в лимиты и переживает перезапуски.",
  },
];

export const docBySlug = (slug: string) => DOCS.find((d) => d.slug === slug);
