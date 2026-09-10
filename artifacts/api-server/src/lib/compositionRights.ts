/**
 * Composition rights for the real benchmark corpus (Brain B-08, the lead's
 * rights ruling of 2026-09-10).
 *
 * A PDMX row's licence statement is the **uploader's** dedication of the
 * **score** — at most the engraving or the arrangement. It says nothing about
 * the composition inside it: "Mamma Mia!" under CC0 is still ABBA's song. The
 * standing rule (charter §2.2, `benchmarkCorpusPlan.ts`: a dataset's licence
 * is not proof of rights in the works inside it) therefore needs a second
 * layer, and this module is it.
 *
 * The mechanism is **admit only what is proven**, never "reject what is
 * known to be copyrighted": a work's composition is public domain when its
 * composer is on the curated list below and died in or before
 * `PUBLIC_DOMAIN_DEATH_YEAR_CUTOFF` (life + 70 as of `RIGHTS_YEAR`), or when
 * the work is a documented traditional / anonymous tune on the curated tune
 * list. Everything else — an unknown name, an uploader's username, a "Misc
 * Computer Games" category, a "Traditional" label on a title the list does
 * not know — is **contested**, with the reason recorded. Contested and
 * unknown are valid answers; nothing here guesses a composer to admit a work.
 *
 * Both layers must clear: the composition through this module, the
 * arrangement / engraving through the uploader's own public-domain statement
 * in the `no_license_conflict` subset (`pdmxIngest.pdmxRefusalReason`).
 */
import { PUBLIC_DOMAIN_DEATH_YEAR_CUTOFF, type PublicDomainComposition } from "./benchmarkCorpusPlan";

export const COMPOSITION_RIGHTS_VERSION = "1.0" as const;

export type PublicDomainComposer = {
  /** The name recorded in the rights basis. */
  name: string;
  /** Year of death. Where scholarship gives only "after N", N is recorded and `note` says so. */
  died: number;
  /** Spellings met in PDMX's composer_name / artist_name, normalised through `foldName`. */
  aliases: string[];
  note?: string;
};

/**
 * Composers whose every composition is public domain under life + 70 as of
 * 2026. Curated from the composer / artist spellings that occur in the
 * admitted multitrack PDMX rows; a composer absent here is not "not public
 * domain", merely unproven, and stays contested until added with a death year.
 */
export const PUBLIC_DOMAIN_COMPOSERS: readonly PublicDomainComposer[] = [
  // --- Renaissance ---------------------------------------------------------
  { name: "Josquin des Prez", died: 1521, aliases: ["josquin des prez", "josquin desprez", "josquin des pres", "josquin"] },
  { name: "Heinrich Isaac", died: 1517, aliases: ["heinrich isaac", "henricus isaac"] },
  { name: "Jacob Obrecht", died: 1505, aliases: ["jacob obrecht"] },
  { name: "Pierre de la Rue", died: 1518, aliases: ["pierre de la rue"] },
  { name: "Loyset Compère", died: 1518, aliases: ["loyset compere"] },
  { name: "Jean Mouton", died: 1522, aliases: ["jean mouton"] },
  { name: "Adrian Willaert", died: 1562, aliases: ["adrian willaert", "adriaan willaert", "adriano willaert"] },
  { name: "Nicolas Gombert", died: 1560, aliases: ["nicolas gombert"], note: "died c. 1560" },
  { name: "Claudin de Sermisy", died: 1562, aliases: ["claudin de sermisy", "claudin sermisy"] },
  { name: "Clément Janequin", died: 1558, aliases: ["clement janequin", "clement jannequin"] },
  { name: "Thomas Crecquillon", died: 1557, aliases: ["thomas crecquillon", "thomas crequillon"] },
  { name: "Jacques Arcadelt", died: 1568, aliases: ["jacques arcadelt", "jacob arcadelt"] },
  { name: "Cipriano de Rore", died: 1565, aliases: ["cipriano de rore", "cypriano de rore"] },
  { name: "Pierre de Manchicourt", died: 1564, aliases: ["pierre de manchicourt"] },
  { name: "Jean Richafort", died: 1547, aliases: ["jean richafort"], note: "died c. 1547" },
  { name: "Cornelius Canis", died: 1561, aliases: ["cornelius canis"] },
  { name: "Tielman Susato", died: 1570, aliases: ["tielman susato", "tylman susato"], note: "died c. 1570" },
  { name: "Orlando di Lasso", died: 1594, aliases: ["orlando di lasso", "orlande de lassus", "orlando lasso", "orlandus lassus", "roland de lassus", "orlando de lassus"] },
  { name: "Ferdinand di Lasso", died: 1609, aliases: ["ferdinando di lasso", "ferdinand di lasso", "ferdinand de lassus"] },
  { name: "Giovanni Pierluigi da Palestrina", died: 1594, aliases: ["giovanni pierluigi da palestrina", "palestrina", "g p da palestrina"] },
  { name: "Tomás Luis de Victoria", died: 1611, aliases: ["tomas luis de victoria", "victoria", "t l de victoria"] },
  { name: "Cristóbal de Morales", died: 1553, aliases: ["cristobal de morales"] },
  { name: "Francisco Guerrero", died: 1599, aliases: ["francisco guerrero"] },
  { name: "Thomas Tallis", died: 1585, aliases: ["thomas tallis", "tallis"] },
  { name: "William Byrd", died: 1623, aliases: ["william byrd", "byrd"] },
  { name: "Thomas Morley", died: 1602, aliases: ["thomas morley"] },
  { name: "Thomas Weelkes", died: 1623, aliases: ["thomas weelkes"] },
  { name: "John Wilbye", died: 1638, aliases: ["john wilbye"] },
  { name: "John Dowland", died: 1626, aliases: ["john dowland", "dowland"] },
  { name: "Orlando Gibbons", died: 1625, aliases: ["orlando gibbons"] },
  { name: "Thomas Tomkins", died: 1656, aliases: ["thomas tomkins"] },
  { name: "Luca Marenzio", died: 1599, aliases: ["luca marenzio", "marenzio"] },
  { name: "Benedetto Pallavicino", died: 1601, aliases: ["benedetto pallavicino"] },
  { name: "Tiburtio Massaino", died: 1608, aliases: ["tiburtio massaino", "tiburzio massaino"], note: "died after 1608" },
  { name: "Sigismondo d'India", died: 1629, aliases: ["sigismondo d'india", "sigismondo d india", "sigismondo dindia"] },
  { name: "Giaches de Wert", died: 1596, aliases: ["giaches de wert", "jacques de wert"] },
  { name: "Leone Leoni", died: 1627, aliases: ["leone leoni", "leon leoni"] },
  { name: "Giovanni Girolamo Kapsperger", died: 1651, aliases: ["giovanni girolamo kapsperger", "gio girolamo kapsperger", "johann hieronymus kapsberger", "kapsperger", "kapsberger"] },
  { name: "Giovanni Ghizzolo", died: 1625, aliases: ["giovanni ghizzolo"] },
  { name: "Jean de Castro", died: 1611, aliases: ["jean de castro"], note: "died c. 1611" },
  { name: "Philippe de Monte", died: 1603, aliases: ["philippe de monte", "philipp de monte"] },
  { name: "Giovanni de Macque", died: 1614, aliases: ["giovanni de macque", "jean de macque"] },
  { name: "Pomponio Nenna", died: 1608, aliases: ["pomponio nenna"] },
  { name: "Luzzasco Luzzaschi", died: 1607, aliases: ["luzzasco luzzaschi", "luzzaschi luzzascho", "luzzaschi"] },
  { name: "Lodovico Agostini", died: 1590, aliases: ["lodovico agostini", "ludovico agostini"] },
  { name: "Ippolito Baccusi", died: 1609, aliases: ["ippolito baccusi"] },
  { name: "Jan Tollius", died: 1603, aliases: ["jan tollius"], note: "died c. 1603" },
  { name: "Giovanni Battista Mosto", died: 1596, aliases: ["giovanni battista mosto", "g b mosto"] },
  { name: "Alfonso Fontanelli", died: 1622, aliases: ["alfonso fontanelli"] },
  { name: "Stefano Felis", died: 1603, aliases: ["stefano felis"], note: "died c. 1603" },
  { name: "Enrico Radesca di Foggia", died: 1625, aliases: ["enrico radesca di foggia", "enrico radesca"] },
  { name: "Costanzo Porta", died: 1601, aliases: ["costanzo porta"] },
  { name: "Giovanni Maria Artusi", died: 1613, aliases: ["giovanni maria artusi", "giovanni artusi"] },
  { name: "Marc'Antonio Ingegneri", died: 1592, aliases: ["marc'antonio ingegneri", "marco antonio ingegneri", "marcantonio ingegneri"] },
  { name: "Claudio Merulo", died: 1604, aliases: ["claudio merulo"] },
  { name: "Andrea Gabrieli", died: 1585, aliases: ["andrea gabrieli"] },
  { name: "Giovanni Gabrieli", died: 1612, aliases: ["giovanni gabrieli"] },
  { name: "Carlo Gesualdo", died: 1613, aliases: ["carlo gesualdo", "gesualdo"] },
  { name: "Claudio Monteverdi", died: 1643, aliases: ["claudio monteverdi", "monteverdi"] },
  { name: "Hans Leo Hassler", died: 1612, aliases: ["hans leo hassler", "hans leo hasler"] },
  { name: "Michael Praetorius", died: 1621, aliases: ["michael praetorius", "praetorius"] },
  { name: "Jan Pieterszoon Sweelinck", died: 1621, aliases: ["jan pieterszoon sweelinck", "sweelinck", "j p sweelinck"] },
  { name: "Johann Hermann Schein", died: 1630, aliases: ["johann hermann schein"] },
  { name: "Heinrich Schütz", died: 1672, aliases: ["heinrich schutz", "heinrich schuetz", "schutz"] },
  { name: "Jacob Handl", died: 1591, aliases: ["jacob handl", "jacobus gallus", "jacob handl gallus", "jacobus handl"] },
  { name: "Samuel Scheidt", died: 1654, aliases: ["samuel scheidt"] },
  { name: "Constantijn Huygens", died: 1687, aliases: ["constantijn huygens"] },
  { name: "Giovanni Croce", died: 1609, aliases: ["giovanni croce"] },
  { name: "Girolamo Frescobaldi", died: 1643, aliases: ["girolamo frescobaldi", "frescobaldi"] },
  { name: "Gregorio Allegri", died: 1652, aliases: ["gregorio allegri"] },
  { name: "Thoinot Arbeau", died: 1595, aliases: ["thoinot arbeau", "jehan tabourot"] },
  { name: "Guillaume Dufay", died: 1474, aliases: ["guillaume dufay", "guillaume du fay", "dufay"] },
  { name: "Johannes Brassart", died: 1455, aliases: ["johannes brassart"], note: "died c. 1455" },
  { name: "Juan del Encina", died: 1530, aliases: ["juan del encina", "juan del enzina"], note: "died 1529 or 1530" },
  { name: "Ludwig Senfl", died: 1543, aliases: ["ludwig senfl"], note: "died c. 1543" },
  { name: "Philippe Verdelot", died: 1552, aliases: ["philippe verdelot"], note: "died before 1552" },
  { name: "Jacobus Clemens non Papa", died: 1556, aliases: ["jacobus clemens non papa", "jacob clemens non papa", "clemens non papa"] },
  { name: "Johann Walter", died: 1570, aliases: ["johann walter", "johann walther"] },
  { name: "Alessandro Striggio", died: 1592, aliases: ["alessandro striggio"], note: "the elder (c. 1536-1592)" },
  { name: "Ascanio Trombetti", died: 1590, aliases: ["ascanio trombetti"] },
  { name: "Gregor Lange", died: 1587, aliases: ["gregor lange", "gregorius langius"] },
  { name: "Lelio Bertani", died: 1612, aliases: ["lelio bertani"] },
  { name: "Giovanni Maria Nanino", died: 1607, aliases: ["giovanni maria nanino", "giovanni maria nanini"] },
  { name: "Thomas Ravenscroft", died: 1635, aliases: ["thomas ravenscroft"], note: "died c. 1635" },
  { name: "Alessandro Grandi", died: 1630, aliases: ["alessandro grandi"] },
  { name: "Melchior Franck", died: 1639, aliases: ["melchior franck"] },
  { name: "Domenico Mazzocchi", died: 1665, aliases: ["domenico mazzocchi"] },
  { name: "John Playford", died: 1687, aliases: ["john playford"], note: "publisher of The English Dancing Master (1651); the tunes are anonymous 17th-century country dances" },
  // --- Baroque -------------------------------------------------------------
  { name: "Henry Purcell", died: 1695, aliases: ["henry purcell", "purcell"] },
  { name: "Johann Pachelbel", died: 1706, aliases: ["johann pachelbel", "pachelbel"] },
  { name: "Arcangelo Corelli", died: 1713, aliases: ["arcangelo corelli", "corelli"] },
  { name: "Antonio Vivaldi", died: 1741, aliases: ["antonio vivaldi", "vivaldi", "a vivaldi"] },
  { name: "Johann Sebastian Bach", died: 1750, aliases: ["johann sebastian bach", "j s bach", "js bach", "bach", "j sebastian bach", "johann s bach"] },
  { name: "George Frideric Handel", died: 1759, aliases: ["george frideric handel", "george frederick handel", "georg friedrich handel", "georg friedrich haendel", "handel", "haendel", "g f handel", "gf handel", "handel george f", "george frederic handel"] },
  { name: "Georg Philipp Telemann", died: 1767, aliases: ["georg philipp telemann", "telemann", "g p telemann"] },
  { name: "Domenico Scarlatti", died: 1757, aliases: ["domenico scarlatti"] },
  { name: "Alessandro Scarlatti", died: 1725, aliases: ["alessandro scarlatti"] },
  { name: "Dieterich Buxtehude", died: 1707, aliases: ["dieterich buxtehude", "dietrich buxtehude", "buxtehude"] },
  { name: "Jean-Baptiste Lully", died: 1687, aliases: ["jean baptiste lully", "lully"] },
  { name: "Jean-Philippe Rameau", died: 1764, aliases: ["jean philippe rameau", "rameau"] },
  { name: "François Couperin", died: 1733, aliases: ["francois couperin", "couperin"] },
  { name: "Francisco Valls", died: 1747, aliases: ["francisco valls", "francesc valls"] },
  { name: "José de Torres y Martínez Bravo", died: 1738, aliases: ["jose de torres y martinez bravo", "jose de torres"] },
  { name: "Tomaso Albinoni", died: 1751, aliases: ["tomaso albinoni", "albinoni"] },
  { name: "Marc-Antoine Charpentier", died: 1704, aliases: ["marc antoine charpentier", "charpentier"] },
  { name: "Johann Joseph Fux", died: 1741, aliases: ["johann joseph fux"] },
  { name: "Jeremiah Clarke", died: 1707, aliases: ["jeremiah clarke"] },
  { name: "Giovanni Battista Pergolesi", died: 1736, aliases: ["giovanni battista pergolesi", "pergolesi"] },
  { name: "Christoph Willibald Gluck", died: 1787, aliases: ["christoph willibald gluck", "gluck"] },
  { name: "Carl Philipp Emanuel Bach", died: 1788, aliases: ["carl philipp emanuel bach", "c p e bach", "cpe bach"] },
  { name: "Johann Christian Bach", died: 1782, aliases: ["johann christian bach", "j c bach"] },
  { name: "Wilhelm Friedemann Bach", died: 1784, aliases: ["wilhelm friedemann bach", "w f bach"] },
  { name: "Antonio Lotti", died: 1740, aliases: ["antonio lotti"] },
  // --- Classical -----------------------------------------------------------
  { name: "Joseph Haydn", died: 1809, aliases: ["joseph haydn", "franz joseph haydn", "haydn", "j haydn"] },
  { name: "Michael Haydn", died: 1806, aliases: ["michael haydn", "johann michael haydn"] },
  { name: "Wolfgang Amadeus Mozart", died: 1791, aliases: ["wolfgang amadeus mozart", "w a mozart", "wa mozart", "mozart", "wolfgang a mozart", "wolfgang mozart"] },
  { name: "Ludwig van Beethoven", died: 1827, aliases: ["ludwig van beethoven", "l van beethoven", "l v beethoven", "beethoven", "ludwig v beethoven"] },
  { name: "Luigi Boccherini", died: 1805, aliases: ["luigi boccherini", "boccherini"] },
  { name: "Muzio Clementi", died: 1832, aliases: ["muzio clementi", "clementi"] },
  { name: "Antonio Salieri", died: 1825, aliases: ["antonio salieri"] },
  { name: "Carl Maria von Weber", died: 1826, aliases: ["carl maria von weber", "c m von weber"] },
  { name: "Franz Schubert", died: 1828, aliases: ["franz schubert", "schubert", "f schubert"] },
  { name: "Gioachino Rossini", died: 1868, aliases: ["gioachino rossini", "gioacchino rossini", "rossini", "g rossini"] },
  { name: "Vincenzo Bellini", died: 1835, aliases: ["vincenzo bellini", "bellini"] },
  { name: "Gaetano Donizetti", died: 1848, aliases: ["gaetano donizetti", "donizetti"] },
  { name: "Niccolò Paganini", died: 1840, aliases: ["niccolo paganini", "paganini"] },
  { name: "Fernando Sor", died: 1839, aliases: ["fernando sor"] },
  { name: "Mauro Giuliani", died: 1829, aliases: ["mauro giuliani"] },
  { name: "Matteo Carcassi", died: 1853, aliases: ["matteo carcassi"] },
  { name: "Ferdinando Carulli", died: 1841, aliases: ["ferdinando carulli"] },
  { name: "Joseph Küffner", died: 1856, aliases: ["joseph kuffner", "joseph kueffner"] },
  { name: "Johann Nepomuk Hummel", died: 1837, aliases: ["johann nepomuk hummel", "hummel"] },
  { name: "Carl Czerny", died: 1857, aliases: ["carl czerny", "czerny"] },
  { name: "Friedrich Kuhlau", died: 1832, aliases: ["friedrich kuhlau", "kuhlau"] },
  { name: "Anton Diabelli", died: 1858, aliases: ["anton diabelli", "diabelli"] },
  // --- Romantic and after (died by 1955) ------------------------------------
  { name: "Felix Mendelssohn", died: 1847, aliases: ["felix mendelssohn", "felix mendelssohn bartholdy", "mendelssohn", "f mendelssohn"] },
  { name: "Fanny Mendelssohn Hensel", died: 1847, aliases: ["fanny mendelssohn", "fanny hensel", "fanny mendelssohn hensel"] },
  { name: "Robert Schumann", died: 1856, aliases: ["robert schumann", "schumann", "r schumann"] },
  { name: "Clara Schumann", died: 1896, aliases: ["clara schumann", "clara wieck"] },
  { name: "Frédéric Chopin", died: 1849, aliases: ["frederic chopin", "chopin", "fryderyk chopin", "f chopin"] },
  { name: "Franz Liszt", died: 1886, aliases: ["franz liszt", "liszt"] },
  { name: "Richard Wagner", died: 1883, aliases: ["richard wagner", "wagner"] },
  { name: "Giuseppe Verdi", died: 1901, aliases: ["giuseppe verdi", "verdi", "g verdi"] },
  { name: "Johannes Brahms", died: 1897, aliases: ["johannes brahms", "brahms", "j brahms"] },
  { name: "Anton Bruckner", died: 1896, aliases: ["anton bruckner", "bruckner"] },
  { name: "Pyotr Ilyich Tchaikovsky", died: 1893, aliases: ["pyotr ilyich tchaikovsky", "peter ilyich tchaikovsky", "tchaikovsky", "p i tchaikovsky", "tschaikowsky", "piotr tchaikovsky", "pyotr tchaikovsky", "peter tchaikovsky", "pjotr iljitsch tschaikowski"] },
  { name: "Antonín Dvořák", died: 1904, aliases: ["antonin dvorak", "dvorak", "a dvorak", "antonin dvoaak"], note: "'dvoaak' is the table's mangled encoding of the same name" },
  { name: "Bedřich Smetana", died: 1884, aliases: ["bedrich smetana", "smetana"] },
  { name: "Edvard Grieg", died: 1907, aliases: ["edvard grieg", "grieg", "e grieg"] },
  { name: "Halfdan Kjerulf", died: 1868, aliases: ["halfdan kjerulf"] },
  { name: "Friedrich August Reissiger", died: 1883, aliases: ["friedrich august reissiger", "f a reissiger"] },
  { name: "Camille Saint-Saëns", died: 1921, aliases: ["camille saint saens", "saint saens"] },
  { name: "Georges Bizet", died: 1875, aliases: ["georges bizet", "bizet"] },
  { name: "Charles Gounod", died: 1893, aliases: ["charles gounod", "gounod", "charles francois gounod"] },
  { name: "Jacques Offenbach", died: 1880, aliases: ["jacques offenbach", "offenbach"] },
  { name: "Hector Berlioz", died: 1869, aliases: ["hector berlioz", "berlioz"] },
  { name: "César Franck", died: 1890, aliases: ["cesar franck", "franck"] },
  { name: "Gabriel Fauré", died: 1924, aliases: ["gabriel faure", "faure"] },
  { name: "Jules Massenet", died: 1912, aliases: ["jules massenet", "massenet"] },
  { name: "Léo Delibes", died: 1891, aliases: ["leo delibes", "delibes"] },
  { name: "Emmanuel Chabrier", died: 1894, aliases: ["emmanuel chabrier"] },
  { name: "Claude Debussy", died: 1918, aliases: ["claude debussy", "debussy"] },
  { name: "Maurice Ravel", died: 1937, aliases: ["maurice ravel", "ravel"] },
  { name: "Erik Satie", died: 1925, aliases: ["erik satie", "satie"] },
  { name: "Louis Vierne", died: 1937, aliases: ["louis vierne", "vierne"] },
  { name: "Charles-Marie Widor", died: 1937, aliases: ["charles marie widor", "widor"] },
  { name: "Arthur Sullivan", died: 1900, aliases: ["arthur sullivan", "arthur s sullivan", "sir arthur sullivan", "sullivan", "gilbert and sullivan", "gilbert sullivan", "w s gilbert and arthur sullivan"], note: "W. S. Gilbert (lyrics) died 1911" },
  { name: "Edward Elgar", died: 1934, aliases: ["edward elgar", "elgar", "sir edward elgar"] },
  { name: "Gustav Holst", died: 1934, aliases: ["gustav holst", "holst"] },
  { name: "Hubert Parry", died: 1918, aliases: ["hubert parry", "c hubert h parry", "charles hubert hastings parry", "parry"] },
  { name: "Charles Villiers Stanford", died: 1924, aliases: ["charles villiers stanford", "stanford"] },
  { name: "George Alexander Macfarren", died: 1887, aliases: ["george alexander macfarren", "g a macfarren"] },
  { name: "William Henry Havergal", died: 1870, aliases: ["william henry havergal", "w h havergal"] },
  { name: "Samuel Webbe", died: 1816, aliases: ["samuel webbe"] },
  { name: "Samuel Sebastian Wesley", died: 1876, aliases: ["samuel sebastian wesley", "s s wesley"] },
  { name: "Samuel Wesley", died: 1837, aliases: ["samuel wesley"] },
  { name: "John Stainer", died: 1901, aliases: ["john stainer", "stainer"] },
  { name: "Joseph Barnby", died: 1896, aliases: ["joseph barnby"] },
  { name: "John Bacchus Dykes", died: 1876, aliases: ["john bacchus dykes", "john b dykes", "j b dykes"] },
  { name: "Henry Smart", died: 1879, aliases: ["henry smart", "henry thomas smart"] },
  { name: "Lowell Mason", died: 1872, aliases: ["lowell mason"] },
  { name: "William Bradbury", died: 1868, aliases: ["william bradbury", "william b bradbury"] },
  { name: "William J. Kirkpatrick", died: 1921, aliases: ["william j kirkpatrick", "william james kirkpatrick", "w j kirkpatrick"] },
  { name: "Ira D. Sankey", died: 1908, aliases: ["ira d sankey", "ira sankey"] },
  { name: "Philip P. Bliss", died: 1876, aliases: ["philip p bliss", "philip bliss", "p p bliss"] },
  { name: "Thomas Clark", died: 1859, aliases: ["thomas clark", "thomas clark of canterbury"], note: "West Gallery composer, Canterbury (1775–1859)" },
  { name: "Oliver Holden", died: 1844, aliases: ["oliver holden"] },
  { name: "William Billings", died: 1800, aliases: ["william billings"] },
  { name: "Jeremiah Ingalls", died: 1838, aliases: ["jeremiah ingalls"] },
  { name: "Jacob French", died: 1817, aliases: ["jacob french"] },
  { name: "Daniel Belknap", died: 1815, aliases: ["daniel belknap"] },
  { name: "Samuel Holyoke", died: 1820, aliases: ["samuel holyoke"] },
  { name: "Daniel Read", died: 1836, aliases: ["daniel read"] },
  { name: "Supply Belcher", died: 1836, aliases: ["supply belcher"] },
  { name: "Timothy Swan", died: 1842, aliases: ["timothy swan"] },
  { name: "Jacob Kimball", died: 1826, aliases: ["jacob kimball"] },
  { name: "Justin Morgan", died: 1798, aliases: ["justin morgan"] },
  { name: "Lewis Edson", died: 1820, aliases: ["lewis edson"] },
  { name: "John Camidge", died: 1859, aliases: ["john camidge"], note: "three organists of York Minster bore the name; the last, John Camidge III, died 1859" },
  { name: "Joseph Stephenson", died: 1810, aliases: ["joseph stephenson"] },
  { name: "Thomas Jarman", died: 1861, aliases: ["thomas jarman"] },
  { name: "John Broderip", died: 1770, aliases: ["john broderip"] },
  { name: "John Wall Callcott", died: 1821, aliases: ["john wall callcott", "j w callcott"] },
  { name: "Hezekiah Moors", died: 1814, aliases: ["hezekiah moors"] },
  { name: "James P. Carrell", died: 1854, aliases: ["james p carrell", "james carrell"] },
  { name: "Samuel Babcock", died: 1813, aliases: ["samuel babcock"] },
  { name: "William Walker", died: 1875, aliases: ["william walker"], note: "compiler of The Southern Harmony (1835)" },
  { name: "Stephen Jenks", died: 1856, aliases: ["stephen jenks"] },
  { name: "Amos Pilsbury", died: 1812, aliases: ["amos pilsbury"] },
  { name: "Abraham Wood", died: 1804, aliases: ["abraham wood"] },
  { name: "Walter Janes", died: 1827, aliases: ["walter janes"] },
  { name: "Ananias Davisson", died: 1857, aliases: ["ananias davisson"] },
  { name: "Oliver Brownson", died: 1815, aliases: ["oliver brownson"] },
  { name: "Stephen Foster", died: 1864, aliases: ["stephen foster", "stephen collins foster", "stephen c foster"] },
  { name: "John Philip Sousa", died: 1932, aliases: ["john philip sousa", "sousa", "j p sousa"] },
  { name: "Scott Joplin", died: 1917, aliases: ["scott joplin", "joplin"] },
  { name: "James Scott", died: 1938, aliases: ["james scott", "james sylvester scott"] },
  { name: "Edward MacDowell", died: 1908, aliases: ["edward macdowell"] },
  { name: "Amy Beach", died: 1944, aliases: ["amy beach", "mrs h h a beach"] },
  { name: "Charles Ives", died: 1954, aliases: ["charles ives"] },
  { name: "George Gershwin", died: 1937, aliases: ["george gershwin", "gershwin"] },
  { name: "Jelly Roll Morton", died: 1941, aliases: ["jelly roll morton"] },
  { name: "Fats Waller", died: 1943, aliases: ["fats waller", "thomas fats waller"] },
  { name: "Giacomo Puccini", died: 1924, aliases: ["giacomo puccini", "puccini"] },
  { name: "Pietro Mascagni", died: 1945, aliases: ["pietro mascagni", "mascagni"] },
  { name: "Ruggero Leoncavallo", died: 1919, aliases: ["ruggero leoncavallo", "leoncavallo"] },
  { name: "Ottorino Respighi", died: 1936, aliases: ["ottorino respighi", "respighi"] },
  { name: "Gustav Mahler", died: 1911, aliases: ["gustav mahler", "mahler"] },
  { name: "Richard Strauss", died: 1949, aliases: ["richard strauss"] },
  { name: "Johann Strauss II", died: 1899, aliases: ["johann strauss ii", "johann strauss jr", "johann strauss sohn", "johann strauss"], note: "the plain spelling is read as the son (d. 1899); the father died 1849" },
  { name: "Johann Strauss I", died: 1849, aliases: ["johann strauss i", "johann strauss sr", "johann strauss vater"] },
  { name: "Josef Strauss", died: 1870, aliases: ["josef strauss"] },
  { name: "Franz Lehár", died: 1948, aliases: ["franz lehar", "lehar"] },
  { name: "Hugo Wolf", died: 1903, aliases: ["hugo wolf"] },
  { name: "Max Reger", died: 1916, aliases: ["max reger", "reger"] },
  { name: "Max Bruch", died: 1920, aliases: ["max bruch", "bruch"] },
  { name: "Engelbert Humperdinck", died: 1921, aliases: ["engelbert humperdinck"], note: "the composer (1854–1921), not the singer who took his name" },
  { name: "Modest Mussorgsky", died: 1881, aliases: ["modest mussorgsky", "mussorgsky", "modest moussorgsky", "moussorgsky"] },
  { name: "Nikolai Rimsky-Korsakov", died: 1908, aliases: ["nikolai rimsky korsakov", "rimsky korsakov", "n rimsky korsakov"] },
  { name: "Alexander Borodin", died: 1887, aliases: ["alexander borodin", "borodin"] },
  { name: "Mikhail Glinka", died: 1857, aliases: ["mikhail glinka", "glinka"] },
  { name: "Sergei Rachmaninoff", died: 1943, aliases: ["sergei rachmaninoff", "sergei rachmaninov", "rachmaninoff", "rachmaninov"] },
  { name: "Alexander Scriabin", died: 1915, aliases: ["alexander scriabin", "scriabin"] },
  { name: "Sergei Prokofiev", died: 1953, aliases: ["sergei prokofiev", "prokofiev"] },
  { name: "Béla Bartók", died: 1945, aliases: ["bela bartok", "bartok"] },
  { name: "Leoš Janáček", died: 1928, aliases: ["leos janacek", "janacek"] },
  { name: "Carl Nielsen", died: 1931, aliases: ["carl nielsen"] },
  { name: "Isaac Albéniz", died: 1909, aliases: ["isaac albeniz", "albeniz"] },
  { name: "Enrique Granados", died: 1916, aliases: ["enrique granados", "granados"] },
  { name: "Manuel de Falla", died: 1946, aliases: ["manuel de falla", "de falla"] },
  { name: "Francisco Tárrega", died: 1909, aliases: ["francisco tarrega", "tarrega"] },
  { name: "Ernesto Nazareth", died: 1934, aliases: ["ernesto nazareth"] },
  { name: "Hugo Distler", died: 1942, aliases: ["hugo distler"] },
  { name: "Anton Webern", died: 1945, aliases: ["anton webern", "webern"] },
  { name: "Alban Berg", died: 1935, aliases: ["alban berg"] },
  { name: "Arnold Schoenberg", died: 1951, aliases: ["arnold schoenberg", "arnold schonberg", "schoenberg"] },
  { name: "Paul Rubens", died: 1917, aliases: ["paul rubens", "paul a rubens"] },
  { name: "Franz Xaver Gruber", died: 1863, aliases: ["franz xaver gruber", "franz gruber", "f x gruber"] },
  { name: "Adolphe Adam", died: 1856, aliases: ["adolphe adam", "adolphe charles adam"] },
  { name: "John Francis Wade", died: 1786, aliases: ["john francis wade"] },
  { name: "James Lord Pierpont", died: 1893, aliases: ["james lord pierpont", "james pierpont", "j pierpont"] },
  { name: "Lewis Redner", died: 1908, aliases: ["lewis redner", "lewis h redner"] },
  { name: "Richard Storrs Willis", died: 1900, aliases: ["richard storrs willis"] },
  { name: "John Henry Hopkins Jr.", died: 1891, aliases: ["john henry hopkins jr", "john henry hopkins", "john h hopkins"] },
  { name: "Henry Gauntlett", died: 1876, aliases: ["henry gauntlett", "henry john gauntlett", "h j gauntlett"] },
  { name: "Conrad Kocher", died: 1872, aliases: ["conrad kocher"] },
  { name: "George Frederick Root", died: 1895, aliases: ["george frederick root", "george f root"] },
  { name: "Henry Clay Work", died: 1884, aliases: ["henry clay work"] },
  { name: "Daniel Decatur Emmett", died: 1904, aliases: ["daniel decatur emmett", "dan emmett", "daniel emmett"] },
  { name: "Mykola Leontovych", died: 1921, aliases: ["mykola leontovych", "leontovych", "mykola leontovich"] },
  { name: "Eduardo di Capua", died: 1917, aliases: ["eduardo di capua"] },
  { name: "Luigi Denza", died: 1922, aliases: ["luigi denza"] },
  { name: "Teodoro Cottrau", died: 1879, aliases: ["teodoro cottrau"] },
  { name: "Francesco Paolo Tosti", died: 1916, aliases: ["francesco paolo tosti", "paolo tosti", "tosti"] },
  { name: "Charles Converse", died: 1918, aliases: ["charles converse", "charles c converse"] },
  { name: "Samuel Coleridge-Taylor", died: 1912, aliases: ["samuel coleridge taylor"] },
  { name: "Edward German", died: 1936, aliases: ["edward german"] },
  { name: "Amilcare Ponchielli", died: 1886, aliases: ["amilcare ponchielli", "ponchielli"] },
  { name: "Louis Moreau Gottschalk", died: 1869, aliases: ["louis moreau gottschalk", "gottschalk"] },
  { name: "Émile Waldteufel", died: 1915, aliases: ["emile waldteufel", "waldteufel"] },
  { name: "Julius Fučík", died: 1916, aliases: ["julius fucik"] },
  { name: "Kenneth Alford", died: 1945, aliases: ["kenneth alford", "kenneth j alford", "frederick joseph ricketts"] },
  { name: "Anton Rubinstein", died: 1894, aliases: ["anton rubinstein"] },
  { name: "Cécile Chaminade", died: 1944, aliases: ["cecile chaminade", "chaminade"] },
  { name: "Ethelbert Nevin", died: 1901, aliases: ["ethelbert nevin"] },
  { name: "Reynaldo Hahn", died: 1947, aliases: ["reynaldo hahn"] },
  { name: "Frederick Delius", died: 1934, aliases: ["frederick delius", "delius"] },
  { name: "Lili Boulanger", died: 1918, aliases: ["lili boulanger"] },
  { name: "Ernest Chausson", died: 1899, aliases: ["ernest chausson", "chausson"] },
  { name: "Vincent d'Indy", died: 1931, aliases: ["vincent d'indy", "vincent d indy", "vincent dindy"] },
  { name: "Paul Dukas", died: 1935, aliases: ["paul dukas", "dukas"] },
  { name: "Albert Roussel", died: 1937, aliases: ["albert roussel"] },
  { name: "John Stafford Smith", died: 1836, aliases: ["john stafford smith"] },
  { name: "Claude Joseph Rouget de Lisle", died: 1836, aliases: ["claude joseph rouget de lisle", "rouget de lisle"] },
  { name: "Mildred J. Hill", died: 1916, aliases: ["mildred j hill", "mildred hill", "mildred and patty hill", "patty and mildred hill"], note: "Patty Hill (lyrics) died 1946" },
  { name: "Daniel Kelley", died: 1905, aliases: ["daniel kelley", "daniel e kelley"] },
  { name: "Benjamin Hanby", died: 1867, aliases: ["benjamin hanby", "benjamin r hanby"] },
  { name: "Ernst Anschütz", died: 1861, aliases: ["ernst anschutz"] },
  { name: "Frederic Austin", died: 1952, aliases: ["frederic austin"] },
  { name: "Wallace Willis", died: 1883, aliases: ["wallace willis"], note: "died c. 1883" },
  { name: "Abraham Zevi Idelsohn", died: 1938, aliases: ["abraham zevi idelsohn", "abraham idelsohn", "a z idelsohn"] },
];

export type VerifiedPublicDomainTune = {
  name: string;
  /** Tested against the folded title. */
  match: RegExp;
  /** Either a documented composer on the list above (looked up by name) or a traditional source. */
  composer?: string;
  traditional?: string;
  /**
   * Whether the title alone is distinctive enough to admit a row that names no
   * composer at all. Liturgical texts and generic titles are false: a modern
   * setting of the same words would pass on the title.
   */
  titleAlone: boolean;
};

/**
 * Tunes whose composition is documented public domain, matched on the title
 * when the row's composer / artist fields name nobody or say "traditional".
 * Every entry names its composer (on the list above) or its traditional source.
 */
export const VERIFIED_PUBLIC_DOMAIN_TUNES: readonly VerifiedPublicDomainTune[] = [
  { name: "Silent Night", match: /\b(silent night|stille nacht)\b/, composer: "Franz Xaver Gruber", titleAlone: true },
  { name: "Adeste Fideles / O Come, All Ye Faithful", match: /\b(adeste fideles|o come all ye faithful)\b/, composer: "John Francis Wade", titleAlone: true },
  { name: "O Holy Night", match: /\b(o holy night|cantique de noel|minuit chretiens?)\b/, composer: "Adolphe Adam", titleAlone: true },
  { name: "Jingle Bells", match: /\bjingle bells\b/, composer: "James Lord Pierpont", titleAlone: true },
  { name: "Hark! The Herald Angels Sing", match: /\bhark the herald angels sing\b/, composer: "Felix Mendelssohn", titleAlone: true },
  { name: "Joy to the World", match: /\bjoy to the world\b/, composer: "Lowell Mason", titleAlone: true },
  { name: "O Little Town of Bethlehem", match: /\bo little town of bethlehem\b/, composer: "Lewis Redner", titleAlone: true },
  { name: "We Three Kings", match: /\bwe three kings\b/, composer: "John Henry Hopkins Jr.", titleAlone: true },
  { name: "It Came Upon the Midnight Clear", match: /\bit came upon (the|a) midnight clear\b/, composer: "Richard Storrs Willis", titleAlone: true },
  { name: "Once in Royal David's City", match: /\bonce in royal david'?s city\b/, composer: "Henry Gauntlett", titleAlone: true },
  { name: "Carol of the Bells / Shchedryk", match: /\b(carol of the bells|shchedryk)\b/, composer: "Mykola Leontovych", titleAlone: true },
  { name: "Up on the Housetop", match: /\bup on the house ?top\b/, composer: "Benjamin Hanby", titleAlone: true },
  { name: "Ode to Joy", match: /\b(ode to joy|ode an die freude|himno de la alegria)\b/, composer: "Ludwig van Beethoven", titleAlone: true },
  { name: "Für Elise", match: /\bfur elise\b/, composer: "Ludwig van Beethoven", titleAlone: true },
  { name: "Moonlight Sonata", match: /\bmoonlight sonata\b/, composer: "Ludwig van Beethoven", titleAlone: true },
  { name: "Canon in D", match: /\b(pachelbel'?s canon|canon in d)\b/, composer: "Johann Pachelbel", titleAlone: true },
  { name: "Hallelujah Chorus", match: /\bhallelujah chorus\b/, composer: "George Frideric Handel", titleAlone: true },
  { name: "Jesu, Joy of Man's Desiring", match: /\bjesu joy of man'?s desiring\b/, composer: "Johann Sebastian Bach", titleAlone: true },
  { name: "Air on the G String", match: /\bair on (the|a) g string\b/, composer: "Johann Sebastian Bach", titleAlone: true },
  { name: "Toccata and Fugue in D minor", match: /\btoccata and fugue in d minor\b/, composer: "Johann Sebastian Bach", titleAlone: true },
  { name: "Eine kleine Nachtmusik", match: /\beine kleine nachtmusik\b/, composer: "Wolfgang Amadeus Mozart", titleAlone: true },
  { name: "The Blue Danube", match: /\b(blue danube|an der schonen blauen donau)\b/, composer: "Johann Strauss II", titleAlone: true },
  { name: "William Tell Overture", match: /\bwilliam tell overture\b/, composer: "Gioachino Rossini", titleAlone: true },
  { name: "In the Hall of the Mountain King", match: /\bin the hall of the mountain king\b/, composer: "Edvard Grieg", titleAlone: true },
  { name: "Flight of the Bumblebee", match: /\bflight of the bumble ?bee\b/, composer: "Nikolai Rimsky-Korsakov", titleAlone: true },
  { name: "Ride of the Valkyries", match: /\bride of the valkyries\b/, composer: "Richard Wagner", titleAlone: true },
  { name: "Clair de lune", match: /\bclair de lune\b/, composer: "Claude Debussy", titleAlone: true },
  { name: "Gymnopédie", match: /\bgymnopedie\b/, composer: "Erik Satie", titleAlone: true },
  { name: "The Entertainer", match: /\bthe entertainer\b/, composer: "Scott Joplin", titleAlone: true },
  { name: "Maple Leaf Rag", match: /\bmaple leaf rag\b/, composer: "Scott Joplin", titleAlone: true },
  { name: "Stars and Stripes Forever", match: /\bstars and stripes forever\b/, composer: "John Philip Sousa", titleAlone: true },
  { name: "The Star-Spangled Banner", match: /\bstar spangled banner\b/, composer: "John Stafford Smith", titleAlone: true },
  { name: "La Marseillaise", match: /\b(la marseillaise|marseilles hymn)\b/, composer: "Claude Joseph Rouget de Lisle", titleAlone: true },
  { name: "Happy Birthday to You", match: /\bhappy birthday( to you)?\b/, composer: "Mildred J. Hill", titleAlone: true },
  { name: "Home on the Range", match: /\bhome on the range\b/, composer: "Daniel Kelley", titleAlone: true },
  { name: "Oh! Susanna", match: /\boh? susanna\b/, composer: "Stephen Foster", titleAlone: true },
  { name: "Camptown Races", match: /\bcamptown races\b/, composer: "Stephen Foster", titleAlone: true },
  { name: "Old Folks at Home / Swanee River", match: /\b(old folks at home|swanee river)\b/, composer: "Stephen Foster", titleAlone: true },
  { name: "Beautiful Dreamer", match: /\bbeautiful dreamer\b/, composer: "Stephen Foster", titleAlone: true },
  { name: "Old Dan Tucker", match: /\bold dan tucker\b/, composer: "Daniel Decatur Emmett", titleAlone: true },
  { name: "O sole mio", match: /\bo sole mio\b/, composer: "Eduardo di Capua", titleAlone: true },
  { name: "Funiculì, Funiculà", match: /\bfunicul[ia] funicul[ia]\b/, composer: "Luigi Denza", titleAlone: true },
  { name: "Santa Lucia", match: /\bsanta lucia\b/, composer: "Teodoro Cottrau", titleAlone: true },
  { name: "O Tannenbaum", match: /\b(o tannenbaum|o christmas tree)\b/, composer: "Ernst Anschütz", titleAlone: true },
  { name: "Hava Nagila", match: /\bhava nagila\b/, traditional: "Hasidic niggun (Sadigura), first notated by A. Z. Idelsohn 1918", titleAlone: true },
  { name: "Greensleeves", match: /\bgreensleeves\b/, traditional: "English broadside ballad tune, registered 1580 (Stationers' Company)", titleAlone: true },
  { name: "What Child Is This", match: /\bwhat child is this\b/, traditional: "Greensleeves (English, 1580); Dix's 1865 text", titleAlone: true },
  { name: "God Rest Ye Merry, Gentlemen", match: /\bgod rest (ye|you) merry\b/, traditional: "English carol, Roud 394, printed by the 1760s", titleAlone: true },
  { name: "We Wish You a Merry Christmas", match: /\bwe wish you a merry christmas\b/, traditional: "English West Country carol, Roud 230", titleAlone: true },
  { name: "The First Noel", match: /\b(the )?first no[ew]ell?\b/, traditional: "Cornish carol, Gilbert 1823 / Sandys 1833", titleAlone: true },
  { name: "Deck the Halls", match: /\bdeck the halls?\b/, traditional: "Welsh air 'Nos Galan', 16th century", titleAlone: true },
  { name: "Away in a Manger", match: /\baway in a manger\b/, traditional: "Murray 1887 (d. 1905) / Kirkpatrick 1895 (d. 1921); both tunes public domain", titleAlone: true },
  { name: "Angels We Have Heard on High", match: /\bangels we have heard on high\b/, traditional: "French carol 'Les anges dans nos campagnes', 18th century", titleAlone: true },
  { name: "Il est né le divin enfant", match: /\bil est ne le divin enfant\b/, traditional: "French carol, printed 1862 (Lorraine)", titleAlone: true },
  { name: "Ding Dong Merrily on High", match: /\bding dong merrily on high\b/, traditional: "Branle de l'Official, Arbeau's Orchésographie 1589", titleAlone: true },
  { name: "Coventry Carol", match: /\bcoventry carol\b/, traditional: "Coventry Pageant of the Shearmen and Tailors, 16th century", titleAlone: true },
  { name: "Sussex Carol", match: /\bsussex carol\b/, traditional: "English carol collected by Vaughan Williams 1904; text 1684", titleAlone: true },
  { name: "Good King Wenceslas", match: /\bgood king wenceslas\b/, traditional: "Tempus adest floridum, Piae Cantiones 1582", titleAlone: true },
  { name: "Gaudete", match: /\bgaudete\b/, traditional: "Piae Cantiones 1582", titleAlone: false },
  { name: "In dulci jubilo", match: /\bin dulci jubilo\b/, traditional: "German carol, 14th century", titleAlone: true },
  { name: "Es ist ein Ros entsprungen / Lo, How a Rose", match: /\b(es ist ein ros|lo how a rose)\b/, traditional: "Speyer Hymnal 1599, harmonised by Praetorius 1609", titleAlone: true },
  { name: "O Come, O Come, Emmanuel", match: /\bo come o come emmanuel\b/, traditional: "15th-century French processional, Veni Emmanuel", titleAlone: true },
  { name: "Bring a Torch, Jeanette, Isabella", match: /\bbring a torch\b/, traditional: "Provençal carol, 17th century", titleAlone: true },
  { name: "The Holly and the Ivy", match: /\bthe holly and the ivy\b/, traditional: "English carol, Roud 514", titleAlone: true },
  { name: "I Saw Three Ships", match: /\bi saw three ships\b/, traditional: "English carol, Roud 700, 17th century", titleAlone: true },
  { name: "Here We Come A-Wassailing", match: /\bwassail(ing)? song|here we come a ?wassailing\b/, traditional: "English wassail song, Roud 209", titleAlone: true },
  { name: "The Twelve Days of Christmas", match: /\btwelve days of christmas\b/, traditional: "English cumulative song (Roud 68); Frederic Austin's 1909 setting (d. 1952)", titleAlone: true },
  { name: "Auld Lang Syne", match: /\bauld lang syne\b/, traditional: "Scottish air, Roud 6294", titleAlone: true },
  { name: "Amazing Grace", match: /\bamazing grace\b/, traditional: "tune New Britain, Columbian Harmony 1829", titleAlone: true },
  { name: "Danny Boy / Londonderry Air", match: /\b(danny boy|londonderry air)\b/, traditional: "Irish air collected by Jane Ross, Petrie 1855", titleAlone: true },
  { name: "Scarborough Fair", match: /\bscarborough fair\b/, traditional: "English ballad, Roud 12", titleAlone: true },
  { name: "Twinkle, Twinkle, Little Star", match: /\btwinkle twinkle\b/, traditional: "Ah! vous dirai-je, maman, French, 1761", titleAlone: true },
  { name: "Yankee Doodle", match: /\byankee doodle\b/, traditional: "Anglo-American tune, 18th century", titleAlone: true },
  { name: "God Save the King", match: /\bgod save the (king|queen)\b/, traditional: "anonymous, printed 1744 (Thesaurus Musicus)", titleAlone: true },
  { name: "Drunken Sailor", match: /\bdrunken sailor\b/, traditional: "sea shanty, Roud 322", titleAlone: true },
  { name: "When the Saints Go Marching In", match: /\bwhen the saints go marching in\b/, traditional: "American gospel hymn, anonymous, printed 1896", titleAlone: true },
  { name: "Down by the Riverside", match: /\bdown by the riverside\b/, traditional: "African-American spiritual, printed 1918", titleAlone: true },
  { name: "Down in the River to Pray", match: /\bdown (in|to) the river to pray\b/, traditional: "African-American spiritual, Slave Songs of the United States 1867", titleAlone: true },
  { name: "Swing Low, Sweet Chariot", match: /\bswing low sweet chariot\b/, traditional: "spiritual attributed to Wallace Willis (d. c. 1883), printed 1873", titleAlone: true },
  { name: "Shenandoah", match: /\bshenandoah\b/, traditional: "American river shanty, Roud 324", titleAlone: true },
  { name: "Loch Lomond", match: /\b(loch lomond|bonnie banks)\b/, traditional: "Scottish song, printed 1841", titleAlone: true },
  { name: "Frère Jacques", match: /\bfrere jacques\b/, traditional: "French round, 18th century", titleAlone: true },
  { name: "Alouette", match: /\balouette\b/, traditional: "French-Canadian folk song, printed 1879", titleAlone: false },
  { name: "Sakura Sakura", match: /\bsakura( sakura)?\b/, traditional: "Japanese folk song, Edo period", titleAlone: false },
  { name: "Arirang", match: /\barirang\b/, traditional: "Korean folk song", titleAlone: true },
  { name: "Mo Li Hua / Jasmine Flower", match: /\b(mo li hua|jasmine flower)\b/, traditional: "Chinese folk song, 18th century", titleAlone: true },
  { name: "La Cucaracha", match: /\bla cucaracha\b/, traditional: "Spanish/Mexican folk corrido", titleAlone: true },
  { name: "Las Mañanitas", match: /\blas mananitas\b/, traditional: "Mexican traditional", titleAlone: true },
  { name: "Kol Nidre", match: /\bkol nidrei?\b/, traditional: "Ashkenazi liturgical melody", titleAlone: true },
  { name: "Dona nobis pacem (round)", match: /\bdona nobis pacem\b/, traditional: "anonymous canon, 17th–18th century", titleAlone: false },
  { name: "Christ ist erstanden", match: /\bchrist ist erstanden\b/, traditional: "German Easter hymn, 12th century", titleAlone: false },
  { name: "Christ lag in Todesbanden", match: /\bchrist lag in todes ?banden\b/, traditional: "Lutheran chorale, 1524", titleAlone: false },
  { name: "Ein feste Burg", match: /\bein feste burg\b/, traditional: "Luther 1529", titleAlone: false },
  { name: "Old Hundredth", match: /\bold (hundredth|100th)\b/, traditional: "Genevan Psalter 1551", titleAlone: false },
  { name: "Ave Maris Stella (plainchant)", match: /\bave maris stella\b/, traditional: "plainchant hymn, 8th century", titleAlone: false },
  { name: "Pange lingua (plainchant)", match: /\bpange lingua\b/, traditional: "plainchant hymn, 13th century", titleAlone: false },
  { name: "Victimae paschali laudes", match: /\bvictim(ae|e) paschali laudes\b/, traditional: "plainchant sequence, 11th century", titleAlone: false },
  { name: "Veni Creator Spiritus", match: /\bveni creator spiritus\b/, traditional: "plainchant hymn, 9th century", titleAlone: false },
];

const PLACEHOLDERS = new Set(["", "na", "n a", "none", "null", "unknown", "composer", "various", "various artists", "me", "myself", "artist", "author", "untitled", "no composer", "unbekannt", "inconnu", "desconocido"]);
const TRADITIONAL_LABELS = /^(traditional|trad|tradicional|traditionnel|traditionell|tradizionale|volkslied|volksweise|folk|folk song|folksong|folk tune|anonymous|anon|anonymus|anonyme|anonimo|anonymous composer|misc traditional|misc christmas|misc tunes|misc carols|misc hymns|misc folk|christmas carol|carol|hymn|spiritual|gregorian|gregorian chant|chant|plainchant|plainsong|public domain|pd|trad arr|traditional arr)$/;
const CATEGORY_LABEL = /^misc\b/;
const ARRANGER_SPLIT = /\b(arr|arrangement|arranged|arrangiert|arrangement by|arr by|transcr|transcribed|transcription|adapted|adaptation|edited|ed|orchestrated|orchestration|harmonised|harmonized|realised|realized|set)\b\.?\s*(by\b)?\s*/;
const TOKEN_SPLIT = /\s*(?:,|;|\/|&|\+|\|| and | x | ft | feat | featuring | with | und | et | y )\s*/;

/** Lower-case, diacritics folded, dates / keys / punctuation removed, one space between words. */
export function foldName(value: string | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(d|b|c|ca|fl|died|born)\.?\s*(?=\d{4})/g, " ")
    .replace(/\d{4}\s*[-–—]?\s*\d{0,4}/g, " ")
    .replace(/^[a-g](#| sharp| flat|b)?\s?(major|minor|dur|moll)\s*/, "")
    .replace(/[-–—]/g, " ")
    .replace(/[.,;:!?"“”]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The folded title: diacritics off, punctuation to spaces. */
export function foldTitle(value: string | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const composerByAlias: Map<string, PublicDomainComposer> = new Map();
for (const composer of PUBLIC_DOMAIN_COMPOSERS) {
  for (const alias of composer.aliases) {
    const key = foldName(alias);
    const existing = composerByAlias.get(key);
    if (existing && existing !== composer) throw new Error(`composition rights: alias "${alias}" names both ${existing.name} and ${composer.name}`);
    composerByAlias.set(key, composer);
  }
}
const composerByName: Map<string, PublicDomainComposer> = new Map(PUBLIC_DOMAIN_COMPOSERS.map((c) => [c.name, c]));
for (const tune of VERIFIED_PUBLIC_DOMAIN_TUNES) {
  if (tune.composer && !composerByName.has(tune.composer)) throw new Error(`composition rights: tune "${tune.name}" names a composer not on the list: ${tune.composer}`);
  if (!tune.composer && !tune.traditional) throw new Error(`composition rights: tune "${tune.name}" has neither a composer nor a traditional source`);
}

export function publicDomainComposer(name: string | undefined): PublicDomainComposer | null {
  return composerByAlias.get(foldName(name)) ?? null;
}

export type CompositionRightsInput = {
  title?: string;
  /** PDMX `composer_name`. */
  composer?: string;
  /** PDMX `artist_name` — often the composer, often a category ("Misc Traditional"), often the uploader's handle. */
  artist?: string;
};

export type CompositionRightsVerdict =
  | { ok: true; basis: PublicDomainComposition; evidence: string }
  | { ok: false; reason: string };

type FieldReading = {
  composers: PublicDomainComposer[];
  /** Multi-word names the list does not know: a person this module cannot clear. */
  unresolved: string[];
  /** Single-word labels the list does not know (a handle, a surname alone): they name no composer but do not contradict a verified title. */
  unattributed: string[];
  traditional: string | null;
  category: string | null;
  arranger: string | null;
};

function readField(value: string | undefined): FieldReading {
  const reading: FieldReading = { composers: [], unresolved: [], unattributed: [], traditional: null, category: null, arranger: null };
  const folded = foldName(value);
  if (PLACEHOLDERS.has(folded)) return reading;
  if (TRADITIONAL_LABELS.test(folded)) { reading.traditional = value!.trim(); return reading; }
  const whole = composerByAlias.get(folded);
  if (whole) { reading.composers.push(whole); return reading; }
  if (CATEGORY_LABEL.test(folded)) { reading.category = value!.trim(); return reading; }

  let composerPart = folded;
  const arr = ARRANGER_SPLIT.exec(folded);
  if (arr) {
    composerPart = folded.slice(0, arr.index).trim();
    reading.arranger = folded.slice(arr.index + arr[0].length).trim() || null;
  }
  for (const raw of composerPart.split(TOKEN_SPLIT)) {
    const token = raw.trim();
    if (!token || PLACEHOLDERS.has(token)) continue;
    if (TRADITIONAL_LABELS.test(token)) { reading.traditional = reading.traditional ?? token; continue; }
    const composer = composerByAlias.get(token);
    if (composer) { if (!reading.composers.includes(composer)) reading.composers.push(composer); continue; }
    if (/\s/.test(token)) reading.unresolved.push(token);
    else reading.unattributed.push(token);
  }
  return reading;
}

const quote = (s: string): string => `"${s.length > 60 ? `${s.slice(0, 57)}...` : s}"`;

/**
 * Whether the composition behind a PDMX row is verifiably public domain, and
 * on what basis. Reads only what the row says about itself; never a guess.
 */
export function compositionRightsFor(input: CompositionRightsInput): CompositionRightsVerdict {
  const fields = [readField(input.composer), readField(input.artist)];
  const unresolved = [...new Set(fields.flatMap((f) => f.unresolved))];
  if (unresolved.length) {
    return { ok: false, reason: `the PDMX row names ${unresolved.map(quote).join(" and ")}, not on the verified public-domain composer list; the composition is unproven` };
  }
  const composers = [...new Set(fields.flatMap((f) => f.composers))];
  const late = composers.find((c) => c.died > PUBLIC_DOMAIN_DEATH_YEAR_CUTOFF);
  if (late) {
    return { ok: false, reason: `${late.name} died in ${late.died}, after the ${PUBLIC_DOMAIN_DEATH_YEAR_CUTOFF} cutoff (life + 70): not yet public domain` };
  }
  if (composers.length) {
    const named = composers.map((c) => c.name).join(" / ");
    const died = Math.max(...composers.map((c) => c.died));
    const notes = composers.filter((c) => c.note).map((c) => `${c.name}: ${c.note}`);
    return {
      ok: true,
      basis: { composer: named, composerDied: died },
      evidence: `composer field${input.artist && fields[1].composers.length ? " / artist field" : ""} names ${named} (d. ${died})${notes.length ? `; ${notes.join("; ")}` : ""}`,
    };
  }

  const traditional = fields.map((f) => f.traditional).find(Boolean) ?? null;
  const category = fields.map((f) => f.category).find(Boolean) ?? null;
  const title = foldTitle(input.title);
  const tune = VERIFIED_PUBLIC_DOMAIN_TUNES.find((t) => t.match.test(title) && (t.titleAlone || traditional));
  if (tune) {
    if (tune.composer) {
      const composer = composerByName.get(tune.composer)!;
      return { ok: true, basis: { composer: composer.name, composerDied: composer.died }, evidence: `title matches the verified tune "${tune.name}" (${composer.name}, d. ${composer.died}); the row names no other composer` };
    }
    return { ok: true, basis: { traditional: true, source: `${tune.name}: ${tune.traditional!}` }, evidence: `title matches the verified traditional tune "${tune.name}"${traditional ? `; row labelled ${quote(traditional)}` : "; the row names no composer"}` };
  }
  if (traditional) {
    return { ok: false, reason: `labelled ${quote(traditional)} by the uploader, but ${quote(input.title?.trim() || "(untitled)")} is not on the verified traditional / public-domain tune list; an uploader's label is not proof` };
  }
  if (category) {
    return { ok: false, reason: `${quote(category)} is a category label, not a composer; the composition is unproven` };
  }
  const unattributed = [...new Set(fields.flatMap((f) => f.unattributed))];
  if (unattributed.length) {
    return { ok: false, reason: `the PDMX row's only attribution is ${unattributed.map(quote).join(", ")}, which names no verified composer; the composition is unproven` };
  }
  return { ok: false, reason: "the PDMX row names no composer and the title is not a verified public-domain tune; the composition is unproven" };
}
