/**
 * Curated team list: FIFA national teams + top club teams from major leagues.
 * Each entry is the team's display name. Doc IDs are derived from these names
 * (see seedTeams.js sanitizer) and the same string is stored in the `name` field.
 */

const NATIONAL_TEAMS = [
  // UEFA
  'Albania', 'Andorra', 'Armenia', 'Austria', 'Azerbaijan', 'Belarus', 'Belgium',
  'Bosnia and Herzegovina', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic',
  'Denmark', 'England', 'Estonia', 'Faroe Islands', 'Finland', 'France', 'Georgia',
  'Germany', 'Gibraltar', 'Greece', 'Hungary', 'Iceland', 'Israel', 'Italy',
  'Kazakhstan', 'Kosovo', 'Latvia', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Malta', 'Moldova', 'Montenegro', 'Netherlands', 'North Macedonia',
  'Northern Ireland', 'Norway', 'Poland', 'Portugal', 'Republic of Ireland',
  'Romania', 'Russia', 'San Marino', 'Scotland', 'Serbia', 'Slovakia', 'Slovenia',
  'Spain', 'Sweden', 'Switzerland', 'Turkey', 'Ukraine', 'Wales',

  // CONMEBOL
  'Argentina', 'Bolivia', 'Brazil', 'Chile', 'Colombia', 'Ecuador', 'Paraguay',
  'Peru', 'Uruguay', 'Venezuela',

  // CONCACAF
  'Anguilla', 'Antigua and Barbuda', 'Aruba', 'Bahamas', 'Barbados', 'Belize',
  'Bermuda', 'British Virgin Islands', 'Canada', 'Cayman Islands', 'Costa Rica',
  'Cuba', 'Curaçao', 'Dominica', 'Dominican Republic', 'El Salvador', 'Grenada',
  'Guatemala', 'Guyana', 'Haiti', 'Honduras', 'Jamaica', 'Mexico', 'Montserrat',
  'Nicaragua', 'Panama', 'Puerto Rico', 'Saint Kitts and Nevis', 'Saint Lucia',
  'Saint Vincent and the Grenadines', 'Suriname', 'Trinidad and Tobago',
  'Turks and Caicos Islands', 'United States', 'U.S. Virgin Islands',

  // CAF
  'Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cameroon',
  'Cape Verde', 'Central African Republic', 'Chad', 'Comoros', 'DR Congo',
  'Republic of the Congo', 'Djibouti', 'Egypt', 'Equatorial Guinea', 'Eritrea',
  'Eswatini', 'Ethiopia', 'Gabon', 'Gambia', 'Ghana', 'Guinea', 'Guinea-Bissau',
  'Ivory Coast', 'Kenya', 'Lesotho', 'Liberia', 'Libya', 'Madagascar', 'Malawi',
  'Mali', 'Mauritania', 'Mauritius', 'Morocco', 'Mozambique', 'Namibia', 'Niger',
  'Nigeria', 'Rwanda', 'São Tomé and Príncipe', 'Senegal', 'Seychelles',
  'Sierra Leone', 'Somalia', 'South Africa', 'South Sudan', 'Sudan', 'Tanzania',
  'Togo', 'Tunisia', 'Uganda', 'Zambia', 'Zimbabwe',

  // AFC
  'Afghanistan', 'Australia', 'Bahrain', 'Bangladesh', 'Bhutan', 'Brunei',
  'Cambodia', 'China', 'Chinese Taipei', 'Guam', 'Hong Kong', 'India', 'Indonesia',
  'Iran', 'Iraq', 'Japan', 'Jordan', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Lebanon',
  'Macau', 'Malaysia', 'Maldives', 'Mongolia', 'Myanmar', 'Nepal', 'North Korea',
  'Oman', 'Pakistan', 'Palestine', 'Philippines', 'Qatar', 'Saudi Arabia',
  'Singapore', 'South Korea', 'Sri Lanka', 'Syria', 'Tajikistan', 'Thailand',
  'Timor-Leste', 'Turkmenistan', 'United Arab Emirates', 'Uzbekistan', 'Vietnam',
  'Yemen',

  // OFC
  'American Samoa', 'Cook Islands', 'Fiji', 'New Caledonia', 'New Zealand',
  'Papua New Guinea', 'Samoa', 'Solomon Islands', 'Tahiti', 'Tonga', 'Vanuatu',
];

const CLUB_TEAMS = [
  // Premier League (England)
  'Arsenal', 'Aston Villa', 'AFC Bournemouth', 'Brentford', 'Brighton & Hove Albion',
  'Chelsea', 'Crystal Palace', 'Everton', 'Fulham', 'Ipswich Town', 'Leicester City',
  'Liverpool', 'Manchester City', 'Manchester United', 'Newcastle United',
  'Nottingham Forest', 'Southampton', 'Tottenham Hotspur', 'West Ham United',
  'Wolverhampton Wanderers',

  // EFL Championship & lower (selected historic English clubs)
  'Leeds United', 'Sheffield United', 'Sheffield Wednesday', 'Sunderland',
  'Norwich City', 'West Bromwich Albion', 'Stoke City', 'Middlesbrough',
  'Burnley', 'Watford', 'Cardiff City', 'Swansea City', 'Hull City',
  'Queens Park Rangers', 'Birmingham City', 'Coventry City', 'Derby County',
  'Preston North End', 'Blackburn Rovers', 'Bristol City', 'Portsmouth',
  'Plymouth Argyle', 'Millwall', 'Reading', 'Bolton Wanderers', 'Wigan Athletic',

  // La Liga (Spain)
  'Deportivo Alavés', 'Athletic Bilbao', 'Atlético Madrid', 'FC Barcelona',
  'Celta Vigo', 'RCD Espanyol', 'Getafe CF', 'Girona FC', 'UD Las Palmas',
  'CD Leganés', 'RCD Mallorca', 'CA Osasuna', 'Rayo Vallecano', 'Real Betis',
  'Real Madrid', 'Real Sociedad', 'Sevilla FC', 'Valencia CF', 'Real Valladolid',
  'Villarreal CF',

  // La Liga 2 / historic Spanish
  'Deportivo La Coruña', 'Real Zaragoza', 'Sporting Gijón', 'Málaga CF',
  'Real Oviedo', 'Cádiz CF', 'Granada CF', 'Elche CF', 'Levante UD',
  'Racing Santander',

  // Serie A (Italy)
  'Atalanta', 'Bologna FC', 'Cagliari Calcio', 'Como 1907', 'Empoli FC',
  'ACF Fiorentina', 'Genoa CFC', 'Hellas Verona', 'Inter Milan', 'Juventus',
  'SS Lazio', 'US Lecce', 'AC Milan', 'AC Monza', 'SSC Napoli', 'Parma Calcio',
  'AS Roma', 'Torino FC', 'Udinese Calcio', 'Venezia FC',

  // Serie B / historic Italian
  'Sampdoria', 'Brescia Calcio', 'Palermo FC', 'Pisa SC', 'Spezia Calcio',
  'Cremonese', 'Cesena FC', 'Bari', 'Catania', 'Reggina',

  // Bundesliga (Germany)
  'Bayer 04 Leverkusen', 'Bayern Munich', 'VfL Bochum', 'Borussia Dortmund',
  'Borussia Mönchengladbach', 'Eintracht Frankfurt', 'FC Augsburg',
  '1. FC Heidenheim', 'FC St. Pauli', 'Holstein Kiel', 'TSG Hoffenheim',
  'Mainz 05', 'RB Leipzig', 'SC Freiburg', 'VfB Stuttgart', '1. FC Union Berlin',
  'Werder Bremen', 'VfL Wolfsburg',

  // 2. Bundesliga / historic German
  'Hamburger SV', '1. FC Köln', 'Hertha BSC', 'Schalke 04', '1. FC Nürnberg',
  'Hannover 96', 'Karlsruher SC', 'Fortuna Düsseldorf', 'Eintracht Braunschweig',
  'SV Darmstadt 98', 'SC Paderborn', 'Greuther Fürth', 'SpVgg Unterhaching',
  'Kaiserslautern',

  // Ligue 1 (France)
  'Angers SCO', 'AJ Auxerre', 'Stade Brestois', 'Le Havre AC', 'RC Lens',
  'Lille OSC', 'Olympique Lyonnais', 'Olympique de Marseille', 'AS Monaco',
  'Montpellier HSC', 'FC Nantes', 'OGC Nice', 'Paris Saint-Germain',
  'Stade de Reims', 'Stade Rennais', 'AS Saint-Étienne', 'RC Strasbourg',
  'Toulouse FC',

  // Ligue 2 / historic French
  'Girondins de Bordeaux', 'En Avant Guingamp', 'SM Caen', 'FC Metz',
  'AC Ajaccio', 'Dijon FCO', 'EA Guingamp', 'Amiens SC', 'AS Nancy',
  'Valenciennes FC', 'Sochaux',

  // Eredivisie (Netherlands)
  'Ajax', 'AZ Alkmaar', 'Feyenoord', 'PSV Eindhoven', 'FC Twente', 'Vitesse',
  'FC Utrecht', 'SC Heerenveen', 'NEC Nijmegen', 'FC Groningen', 'Sparta Rotterdam',
  'Go Ahead Eagles', 'Heracles Almelo', 'Willem II', 'Fortuna Sittard',
  'PEC Zwolle', 'NAC Breda', 'RKC Waalwijk', 'Almere City',

  // Primeira Liga (Portugal)
  'SL Benfica', 'FC Porto', 'Sporting CP', 'SC Braga', 'Vitória SC', 'Boavista FC',
  'CF Os Belenenses', 'Marítimo', 'Rio Ave', 'Estoril Praia', 'Famalicão',
  'Gil Vicente', 'Moreirense', 'Casa Pia', 'Arouca', 'Santa Clara',
  'Portimonense', 'Estrela da Amadora',

  // Belgian Pro League
  'Anderlecht', 'Club Brugge', 'Standard Liège', 'KAA Gent', 'Antwerp FC',
  'KRC Genk', 'Cercle Brugge', 'Charleroi', 'KV Mechelen', 'Sint-Truiden',
  'Westerlo', 'OH Leuven', 'Beerschot', 'Union Saint-Gilloise',

  // Süper Lig (Turkey)
  'Galatasaray', 'Fenerbahçe', 'Beşiktaş', 'Trabzonspor', 'Başakşehir',
  'Adana Demirspor', 'Konyaspor', 'Antalyaspor', 'Kayserispor', 'Alanyaspor',
  'Rizespor', 'Sivasspor', 'Gaziantep FK', 'Samsunspor', 'Bodrumspor',
  'Kasımpaşa', 'Eyüpspor', 'Hatayspor', 'Göztepe', 'Bucaspor',

  // Greek Super League
  'Olympiacos', 'Panathinaikos', 'AEK Athens', 'PAOK', 'Aris Thessaloniki',
  'OFI Crete', 'Atromitos', 'Asteras Tripolis', 'Volos NFC', 'Lamia',
  'Panetolikos', 'Levadiakos',

  // Scottish Premiership
  'Celtic', 'Rangers', 'Aberdeen', 'Hearts', 'Hibernian', 'Dundee United',
  'Motherwell', 'St. Mirren', 'Kilmarnock', 'Ross County', 'St. Johnstone',
  'Dundee FC',

  // Other UEFA strong clubs
  'Shakhtar Donetsk', 'Dynamo Kyiv', 'Red Star Belgrade', 'Partizan Belgrade',
  'Dinamo Zagreb', 'Hajduk Split', 'Sparta Prague', 'Slavia Prague',
  'Viktoria Plzeň', 'Legia Warsaw', 'Lech Poznań', 'Wisła Kraków',
  'Cracovia', 'Pogoń Szczecin', 'CFR Cluj', 'FCSB', 'Dinamo București',
  'Ferencváros', 'MTK Budapest', 'Slovan Bratislava', 'Slovan Liberec',
  'Maribor', 'Ludogorets', 'Levski Sofia', 'CSKA Sofia',
  'RB Salzburg', 'Rapid Wien', 'Austria Wien', 'Sturm Graz', 'LASK',
  'FC Basel', 'Young Boys', 'FC Zürich', 'Servette FC', 'Grasshopper Club Zürich',
  'FC Copenhagen', 'Brøndby IF', 'FC Midtjylland', 'AGF Aarhus',
  'Rosenborg BK', 'Molde FK', 'Bodø/Glimt', 'Vålerenga', 'Lillestrøm',
  'Malmö FF', 'IFK Göteborg', 'AIK', 'Djurgårdens IF', 'Hammarby IF',
  'Helsingborgs IF', 'IFK Norrköping',
  'HJK Helsinki', 'KuPS', 'FC Inter Turku',
  'Maccabi Tel Aviv', 'Hapoel Tel Aviv', 'Beitar Jerusalem', 'Maccabi Haifa',
  'Hapoel Beer Sheva', 'Maccabi Netanya',
  'Zenit Saint Petersburg', 'Spartak Moscow', 'CSKA Moscow', 'Lokomotiv Moscow',
  'Dinamo Moscow', 'Rubin Kazan', 'Krasnodar',

  // Brazilian Série A
  'Flamengo', 'Palmeiras', 'Corinthians', 'São Paulo FC', 'Santos FC',
  'Fluminense', 'Botafogo', 'Vasco da Gama', 'Grêmio', 'Internacional',
  'Cruzeiro', 'Atlético Mineiro', 'EC Bahia', 'Athletico Paranaense',
  'Coritiba', 'Sport Recife', 'Vitória', 'Fortaleza', 'Ceará SC',
  'Goiás', 'América Mineiro', 'Chapecoense', 'Cuiabá', 'Bragantino',

  // Argentine Primera División
  'Boca Juniors', 'River Plate', 'Independiente', 'Racing Club', 'San Lorenzo',
  'Estudiantes', 'Vélez Sarsfield', "Newell's Old Boys", 'Rosario Central',
  'Gimnasia La Plata', 'Lanús', 'Banfield', 'Argentinos Juniors', 'Huracán',
  'Tigre', 'Talleres', 'Belgrano', 'Colón', 'Unión', 'Defensa y Justicia',
  'Godoy Cruz', 'Platense', 'Central Córdoba', 'Atlético Tucumán',

  // Other Conmebol giants
  'Universidad de Chile', 'Colo-Colo', 'Universidad Católica', 'Cobreloa',
  'Peñarol', 'Nacional', 'Olimpia', 'Cerro Porteño', 'Libertad', 'Guaraní',
  'LDU Quito', 'Barcelona SC', 'Emelec', 'Independiente del Valle',
  'Atlético Nacional', 'Millonarios', 'América de Cali', 'Junior',
  'Deportivo Cali', 'Santa Fe', 'Once Caldas',
  'Alianza Lima', 'Universitario', 'Sporting Cristal', 'Melgar',
  'Caracas FC', 'Deportivo Táchira', 'The Strongest', 'Bolívar',

  // MLS
  'Atlanta United', 'Austin FC', 'CF Montréal', 'Charlotte FC', 'Chicago Fire',
  'Colorado Rapids', 'Columbus Crew', 'D.C. United', 'FC Cincinnati', 'FC Dallas',
  'Houston Dynamo', 'Inter Miami', 'LA Galaxy', 'Los Angeles FC',
  'Minnesota United', 'Nashville SC', 'New England Revolution', 'New York City FC',
  'New York Red Bulls', 'Orlando City', 'Philadelphia Union', 'Portland Timbers',
  'Real Salt Lake', 'San Jose Earthquakes', 'Seattle Sounders',
  'Sporting Kansas City', 'St. Louis City', 'Toronto FC', 'Vancouver Whitecaps',
  'San Diego FC',

  // Liga MX
  'Club América', 'Chivas Guadalajara', 'Cruz Azul', 'Pumas UNAM', 'Tigres UANL',
  'Monterrey', 'Santos Laguna', 'Toluca', 'Pachuca', 'León', 'Atlas', 'Necaxa',
  'Puebla', 'Querétaro', 'Tijuana', 'Mazatlán', 'Atlético San Luis', 'Juárez',

  // Saudi Pro League
  'Al-Hilal', 'Al-Nassr', 'Al-Ittihad', 'Al-Ahli SFC', 'Al-Ettifaq',
  'Al-Shabab', 'Al-Taawoun', 'Al-Fateh', 'Al-Fayha', 'Al-Khaleej',
  'Al-Wehda', 'Damac', 'Al-Riyadh', 'Al-Okhdood', 'Al-Raed',

  // UAE / Qatar / other Gulf
  'Al Ain', 'Al Wasl', 'Al Jazira', 'Shabab Al-Ahli', 'Al Wahda',
  'Al Sadd', 'Al Duhail', 'Al Rayyan', 'Al Arabi', 'Al Gharafa',

  // J1 League (Japan)
  'Kashima Antlers', 'Urawa Red Diamonds', 'Yokohama F. Marinos', 'Vissel Kobe',
  'Gamba Osaka', 'Cerezo Osaka', 'Kawasaki Frontale', 'FC Tokyo',
  'Sanfrecce Hiroshima', 'Shimizu S-Pulse', 'Júbilo Iwata', 'Nagoya Grampus',
  'Yokohama FC', 'Consadole Sapporo', 'Albirex Niigata', 'Kashiwa Reysol',
  'Avispa Fukuoka', 'Sagan Tosu', 'Tokyo Verdy', 'Machida Zelvia',

  // K League (South Korea)
  'Jeonbuk Hyundai Motors', 'FC Seoul', 'Ulsan HD FC', 'Pohang Steelers',
  'Suwon Samsung Bluewings', 'Daegu FC', 'Gangwon FC', 'Gwangju FC',
  'Incheon United', 'Jeju United', 'Seongnam FC',

  // Chinese Super League
  'Shanghai Port', 'Beijing Guoan', 'Guangzhou FC', 'Shanghai Shenhua',
  'Shandong Taishan', 'Wuhan Three Towns', 'Tianjin Jinmen Tiger',
  'Chengdu Rongcheng', 'Henan Songshan Longmen', 'Zhejiang FC',

  // CAF strong clubs
  'Al Ahly', 'Zamalek SC', 'Pyramids FC', 'Ismaily SC',
  'Espérance de Tunis', 'Étoile du Sahel', 'Club Africain', 'CS Sfaxien',
  'Wydad Casablanca', 'Raja Casablanca', 'FAR Rabat', 'RS Berkane',
  'TP Mazembe', 'Vita Club', 'Mamelodi Sundowns', 'Kaizer Chiefs',
  'Orlando Pirates', 'SuperSport United', 'Cape Town City', 'Stellenbosch FC',
  'Enyimba', 'Rivers United', 'Hearts of Oak', 'Asante Kotoko',
  'Gor Mahia', 'AFC Leopards', 'Simba SC', 'Young Africans',
  'USM Alger', 'CR Belouizdad', 'JS Kabylie', 'MC Alger',
];

module.exports = { NATIONAL_TEAMS, CLUB_TEAMS };
