export const ANSWERS = `
adore agile alarm album alert alike alive ample angel ankle apple apron argue arise armor aroma
aside audio avoid awake award aware badge baker balmy beach beard beast begin bench berry birth black
blade blame blank blast blaze blend bless blind block bloom blown board boast bonus boost booth bound
brain brake brave bread break brick bride brief bring broad broke brook brown brush build cable camel
candy carry carve catch cause cedar chain chair chalk charm chase cheap cheer chest chief child chill
choir chose cider claim clean clear clerk climb cloak clock cloud coach coast color coral count court
cover craft crane crash cream creek crisp crowd crown curve daily dance dealt death decor delay depth
diary diner dirty doubt dozen draft drain drama dream dress dried drink drive eager early earth eight
elite empty enjoy enter entry equal error event every exact faith false fancy favor feast field fiery
fifth fight final first flame flare flash fleet flesh float flock floor flour focus force forge forth
frame fresh front frost fruit funny giant given glass globe glory grace grain grand grant grape graph
grass great green greet grief grind group grove grown guard guess guest guide habit happy heart heavy
honey horse hotel house human ideal image imply index inner ivory jewel joint judge kneel known label
large laser later laugh layer learn least lemon light lilac limit linen local lodge logic loose lucky
lunar magic major maker maple march match maybe medal merry metal might minor model money month moral
motor mount mouse movie music never night noble noise north novel nurse ocean offer often olive onset
opera orbit order organ other ought ounce paint panel paper party pause peace pearl phase phone piano
piece pilot place plain plane plant plate point porch pound power press price pride prime print prize
proof proud queen quick quiet radio raise rally reach react ready realm relay renew reply right rigid
ripen river roast robot rocky rough round route royal ruler saint sauce scale scare scene scope score
serve shade shake shape share sharp sheet shelf shell shift shine shirt shock shore short shout sight
skill slate sleep slice slide slope small smart smile smoke solar solid sound south space spare speak
speed spice spike spine spite split sport stack stage stair stake stand start steam steel steep stick
still stone store storm story stove strap straw strip study style sugar suite sweet table teach thank
their theme there thick thing think those three throw tiger timer toast today token topic total touch
tough tower trace track trade trail train treat trend trial tribe trick trust truth union unity upper
urban usage value video visit vital voice waste watch water weary wheat wheel where which while white
whole woman world worry worth would wound write wrong youth zebra
`.trim().split(/\s+/);

const EXTRA = `
aback abase abate abbey about above actor acute admit adopt adult after again agent agree ahead aisle
allow alloy alone along alter among amuse angry antic anvil arena array arrow asset atlas attic avert
basic basin batch bathe baton below biome birch bison bleak bleed blink blitz blond blunt blush braid
brand brass brawl breed brine brink brisk budge buggy bully bunch burnt buyer cabin cache cairn canal
canoe cargo cater cease chant chart cheat chess chick china chunk civic civil clash clasp class cling
clink clone close clown clued clump comma couch cough could coupe covet cower crack crate crawl crazy
croak crude cruel crumb crush cubic curry cycle daisy debit debut delta dense depot devil digit disco
ditch diver dodge donor dowel dowry drown drunk duchy dummy dusty dwarf dwell eagle ebony edict eerie
elder elect email enact enemy epoch equip erase ethic evade exile exist extra fable facet faint fairy
fault ferry fewer fiber ficus filet filly fizzy fjord flake flank flask fleck flick flint flirt flood
floss fluid flute foamy folly forte forty found frail fraud freak freed freer friar fried frill frisk
frown fudge fully funky gamer gavel gauge gaudy ghost glaze gleam glide gloom gloss glove goofy gouge
gourd grade grail grasp grave graze grill gripe groan gross guild guilt gummy hairy handy harsh haste
haunt haven hazel heard hedge hefty hello hence hinge hippo hitch hoard hobby holly honor hound hover
humid hurry icing idiot igloo incur inert infer intro issue itchy jaunt jelly jolly kiosk kitty knack
knave knife knock koala lanky latch latte leafy lease ledge lever liege llama lofty lotus lousy lover
lower lucid lunch mango manor marsh mason matte mayor mercy merge merit mimic minty minus moist moose
mound mourn naive nasty naval needy nerve nifty ninja ninth oddly olden onion optic outdo outer owner
oxide ozone panda panic paste patch patio peach pecan penny petal petty photo pinch pitch plaid plank
plaza plead plume poise poker polar probe prone pulse punch puppy purse quake quart query quest quilt
quota raven razor rebut recut resin rider ridge rifle rinse risky rival robin roomy rotor rouge rowdy
rugby rural rusty salad salon sandy satin scout scrub seize sense shaky shall shear sheep sheer shire
silky since sixty skate skull skunk slash sleek sloth slump snail snare sneak sober soggy spade spark
spear spell spent spiel spill spray squad staff stark stead stock stomp stood stool stray stuck sunny
swamp swear sweep swell swing sword taste taunt thorn thumb tidal tight titan title tonic tooth torch
toxic tread troop truck truly tulip twist ultra uncle under until venue verge verse vinyl virus vivid
wacky waltz wedge weird wharf widow wince witch witty woody wrath wreck wrist yeast yield young zesty
`.trim().split(/\s+/);

export const VALID_GUESSES = new Set([...ANSWERS, ...EXTRA]);
