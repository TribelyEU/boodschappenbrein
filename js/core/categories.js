// Categorieën en automatische indeling op trefwoorden.

export const CATEGORIES = [
  { id: 'groente-fruit', name: 'Groente en fruit', color: '#4E9A6B', model: 'snel' },
  { id: 'zuivel', name: 'Zuivel', color: '#7FA7D1', model: 'snel' },
  { id: 'brood-ontbijt', name: 'Brood en ontbijt', color: '#D3A35B', model: 'snel' },
  { id: 'vlees-vis-vega', name: 'Vlees, vis en vegetarisch', color: '#C46A5A', model: 'snel' },
  { id: 'houdbaar', name: 'Houdbare voeding', color: '#A88B6C', model: 'houdbaar' },
  { id: 'diepvries', name: 'Diepvries', color: '#6CB6C2', model: 'houdbaar' },
  { id: 'dranken', name: 'Dranken', color: '#8C7BC0', model: 'houdbaar' },
  { id: 'snacks', name: 'Snacks en snoep', color: '#D97B9B', model: 'onregelmatig' },
  { id: 'verzorging', name: 'Verzorging', color: '#B0A2D6', model: 'huishoud' },
  { id: 'schoonmaak', name: 'Schoonmaak', color: '#5E8FA8', model: 'huishoud' },
  { id: 'huishouden', name: 'Huishoudelijke artikelen', color: '#8A9499', model: 'huishoud' },
  { id: 'overig', name: 'Overig', color: '#B9B4AA', model: 'onregelmatig' },
];

// Pseudo-categorie voor kortingen die niet aan een product te koppelen zijn.
export const UNASSIGNED_DISCOUNT = { id: 'korting', name: 'Niet-toegewezen korting', color: '#9CC5A1' };

const BY_ID = Object.fromEntries([...CATEGORIES, UNASSIGNED_DISCOUNT].map((c) => [c.id, c]));

export function categoryName(id) { return BY_ID[id]?.name || 'Overig'; }
export function categoryColor(id) { return BY_ID[id]?.color || '#B9B4AA'; }
export function categoryModel(id) { return BY_ID[id]?.model || 'onregelmatig'; }

// Volgorde is belangrijk: specifieke woorden eerst (bv. 'chocolademelk' vóór 'melk').
const RULES = [
  ['diepvries', ['diepvriespizza', 'aviko', 'iglo', 'mora', 'diepvries', 'ijs ', 'ijsje', 'magnum', 'ola ', 'frites', 'friet', 'kroket', 'bitterbal', 'loempia', 'diepvr', 'spinazie diep', 'vissticks', 'fishsticks', 'erwten diep']],
  ['schoonmaak', ['wasmiddel', 'wasmid', 'vaatwas', 'afwasmiddel', 'afwasm', 'allesreiniger', 'schoonmaak', 'wc eend', 'wc-eend', 'toiletblok', 'bleek', 'glorix', 'dettol', 'ontkalker', 'wasverzachter', 'wasverz', 'vlekverwijder', 'sponzen', 'spons', 'dreft', 'ariel', 'robijn', 'omo', 'persil', 'finish', 'sun ', 'reiniger', 'vaatdoek', 'microvezel']],
  ['huishouden', ['toiletpapier', 'toiletp', 'wc papier', 'wcpapier', 'keukenpapier', 'keukenrol', 'tissues', 'zakdoek', 'vuilniszak', 'afvalzak', 'pedaalemmerzak', 'aluminiumfolie', 'aluf', 'vershoudfolie', 'bakpapier', 'diepvrieszak', 'batterij', 'lamp', 'kaars', 'luciferr', 'servet', 'boterhamzak', 'tas ', 'draagtas', 'plastic tas', 'luier', 'pampers', 'billendoek', 'vochtige doek']],
  ['verzorging', ['hooikoorts', 'neusspray', 'keelpastille', 'tandpasta', 'tandenborstel', 'shampoo', 'conditioner', 'douche', 'zeep', 'deodorant', 'deo ', 'scheer', 'maandverband', 'tampon', 'bodylotion', 'zonnebrand', 'creme', 'crème', 'nivea', 'dove', 'andrelon', 'zwitsal', 'pleister', 'paracetamol', 'ibuprofen', 'vitamine', 'wattenstaaf', 'make up', 'mondwater', 'lenzen', 'nagel']],
  ['dranken', ['maza', 'maaza', 'smoothie', 'sap ', 'cono sur', 'wijn', 'prosecco', 'cava', 'appelsientje', 'roosvicee', 'karvan', 'dubbelfrisss', 'chocolademelk', 'chocomel', 'koffie', 'thee', 'frisdrank', 'cola', 'sinas', 'fanta', 'sprite', 'ice tea', 'icetea', 'limonade', 'siroop', 'ranja', 'sap ', 'sinaasappelsap', 'appelsap', 'jus d', 'smoothie', 'water', 'spa ', 'bier', 'heineken', 'wijn', 'rose', 'prosecco', 'radler', 'energy', 'red bull', 'pakjes', 'capri sun', 'wicky', 'koffiepad', 'senseo', 'nespresso', 'koffiebon', 'cup a soup', 'drinkyoghurt']],
  ['zuivel', ['goudkuipje', 'geraspt', 'rasp', 'skyr', 'smeerkaas', 'roomkaas', 'pondstuk', '45+', '48+', 'scharreleieren', 'vla vanil', 'kookroom', 'melk', 'halfvol', 'karnemelk', 'yoghurt', 'yogh', 'kwark', 'skyr', 'vla', 'pudding', 'toetje', 'room', 'slagroom', 'kookroom', 'creme fraiche', 'zure room', 'boter', 'roomboter', 'margarine', 'halvarine', 'blue band', 'kaas', 'jong belegen', 'belegen', 'oud kaas', 'geitenkaas', 'mozzarella', 'feta', 'parmezaan', 'brie', 'smeerkaas', 'eieren', 'eier', 'ei ', 'danone', 'campina', 'arla', 'optimel', 'fristi', 'petit', 'danoontje', 'mona', 'zuivel', 'vifit']],
  ['brood-ontbijt', ['pank', 'poffertjes', 'choco s', 'hazeln', 'focaccia', 'tijger', 'stokbr', 'croissant', 'kaiserbroodjes', 'baguettes', 'broodje', 'granola', 'rijstwafel', 'rijstwaf', 'brood', 'volkoren', 'bolletje', 'bollen', 'broodje', 'kaiser', 'stokbrood', 'baguette', 'croissant', 'krentenbol', 'beschuit', 'cracker', 'knackebrod', 'rijstwafel', 'ontbijtkoek', 'peperkoek', 'cruesli', 'muesli', 'granola', 'cornflakes', 'havermout', 'brinta', 'pindakaas', 'hagelslag', 'vlokken', 'jam', 'confiture', 'hazelnootpasta', 'nutella', 'appelstroop', 'honing', 'speculoos', 'wrap', 'pita', 'tortilla', 'pannenkoek', 'tijgerbrood', 'casino', 'waldkorn', 'bake off', 'afbak']],
  ['vlees-vis-vega', ['maaltijd', 'vlees', 'stoofvlees', 'carpaccio', 'fil amer', 'americain', 'balletjes', 'yakitori', 'chicken', 'chick', 'cordon bleu', 'kipgrill', 'hamblokje', 'gehaktballen', 'paté', 'pate', 'kips', 'spekreepjes', 'sate', 'saté', 'vega ', 'kip', 'kipfilet', 'kippendij', 'drumstick', 'gehakt', 'rundergehakt', 'rund', 'varken', 'speklap', 'spek', 'ontbijtspek', 'bacon', 'worst', 'rookworst', 'braadworst', 'hamburger', 'burger', 'schnitzel', 'biefstuk', 'shoarma', 'gyros', 'filet', 'karbonade', 'slavink', 'ham', 'salami', 'cervelaat', 'kipfilet beleg', 'rosbief', 'fricandeau', 'zalm', 'vis', 'tonijn', 'kabeljauw', 'pangasius', 'garnaal', 'mosselen', 'haring', 'makreel', 'tofu', 'tempeh', 'vegetarisch', 'vega ', 'vegan', 'falafel', 'beyond', 'vivera', 'garden gourmet', 'vegetarische slager', 'kipstuk', 'gehaktbal', 'knakworst', 'leverworst', 'pastrami', 'chorizo']],
  ['groente-fruit', ['hutspot', 'tauge', 'taugé', 'knijpfruit', 'knijpzak', 'selderij', 'aardbei', 'bessen', 'frambozen', 'champ', 'druiven', 'sperzie', 'broccoli', 'limoen', 'stamppot', 'banaan', 'banan', 'appel', 'peer', 'sinaasappel', 'mandarijn', 'clementine', 'citroen', 'limoen', 'druif', 'druiven', 'aardbei', 'blauwe bes', 'bessen', 'framboos', 'frambozen', 'kiwi', 'mango', 'ananas', 'meloen', 'watermeloen', 'perzik', 'nectarine', 'pruim', 'avocado', 'tomaat', 'tomaten', 'komkommer', 'paprika', 'sla ', 'ijsbergsla', 'rucola', 'spinazie', 'andijvie', 'boerenkool', 'broccoli', 'bloemkool', 'wortel', 'wortel', 'winterpeen', 'peen', 'ui ', 'uien', 'rode ui', 'knoflook', 'champignon', 'courgette', 'aubergine', 'prei', 'selderij', 'bleekselderij', 'sperziebonen', 'boontjes', 'snijbonen', 'spruitjes', 'kool', 'aardappel', 'aardappelen', 'krieler', 'zoete aardappel', 'mais kolf', 'radijs', 'biet', 'gember', 'verse kruiden', 'basilicum', 'peterselie', 'snoeptomaat', 'groente', 'fruit', 'appelpartjes', 'rauwkost', 'maaltijdsalade', 'roerbak', 'soepgroente', 'stamppot']],
  ['snacks', ['spekkoek', 'tompoucen', 'tompouce', 'lange vingers', 'red band', 'cote d or', 'chio', 'lay s', 'dierenkoekjes', 'chocolade vlokken', 'koetjesreep', 'rozijntjes', 'dadeltjes', 'fruit rolls', 'gebakken uitjes', 'stroopwafels', 'muffin', 'brownie', 'popcorn', 'chips', 'lays', 'pringles', 'doritos', 'nootjes', 'pinda', 'cashew', 'noten', 'borrel', 'koek', 'koekje', 'biscuit', 'stroopwafel', 'chocolade', 'reep', 'tony', 'milka', 'snoep', 'drop', 'winegum', 'haribo', 'lolly', 'm&m', 'mars', 'snickers', 'twix', 'kitkat', 'popcorn', 'zoutje', 'tuc', 'liga', 'evergreen', 'sultana', 'snack', 'mueslireep', 'ontbijtkoekje', 'gevulde koek', 'cake', 'taart', 'gebak', 'donut', 'wafel', 'kaasstengel', 'paaseitjes', 'pepernoot', 'kruidnoot', 'chocoladeletter']],
  ['houdbaar', ['tuinerwten', 'kaneel', 'boemboe', 'mihoen', 'noodles', 'goodnoodles', 'deeg', 'bouillon', 'sambal', 'spaghett', 'soepgroen', 'appelstroop', 'mix voor', 'pasta', 'spaghetti', 'macaroni', 'penne', 'fusilli', 'lasagne', 'tagliatelle', 'noedel', 'mie', 'rijst', 'couscous', 'bulgur', 'quinoa', 'meel', 'bloem ', 'suiker', 'zout', 'peper', 'kruiden', 'specerij', 'olie', 'olijfolie', 'zonnebloemolie', 'azijn', 'saus', 'pastasaus', 'tomatenpuree', 'passata', 'ketchup', 'mayonaise', 'mayo', 'mosterd', 'sambal', 'ketjap', 'sojasaus', 'bouillon', 'soep', 'blik', 'bonen', 'kikkererwten', 'linzen', 'mais', 'tonijn in', 'olijven', 'augurk', 'zilveruitjes', 'appelmoes', 'pindasaus', 'mix voor', 'maggi', 'knorr', 'honig', 'conimex', 'bakmix', 'gist', 'paneermeel', 'cacao', 'puree', 'stroop', 'crackers']],
];

/**
 * Bepaalt de categorie van een productnaam op basis van trefwoorden.
 * Geeft { id, confidence } terug; confidence 0 = geen trefwoord gevonden.
 */
export function guessCategory(name) {
  const n = ' ' + String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9&]+/g, ' ') + ' ';
  // Het langste passende trefwoord wint; bij gelijke lengte de eerdere regel.
  let best = null;
  for (const [id, words] of RULES) {
    for (const w of words) {
      const hit = w.endsWith(' ') ? n.includes(' ' + w) : n.includes(w);
      if (!hit) continue;
      // Woordbegin telt zwaarder: "haribo bananas" is snoep, ook al staat "ananas" erin.
      const len = w.trim().length + (n.includes(' ' + w.trim()) ? 3 : 0);
      if (!best || len > best.len) best = { id, len };
    }
  }
  if (!best) return { id: 'overig', confidence: 0 };
  return { id: best.id, confidence: best.len >= 5 ? 0.8 : 0.6 };
}
