<!doctype html>
<html lang="ru-RU">
<head>
<title>TotemCraft - Онлайн-карта</title>
<meta charset="utf-8">
<meta name="description" content="Онлайн-карта мира TotemCraft: изометрическая карта обычного мира, обновляется раз в сутки.">
<meta name="keywords" content="minecraft, server, карта, онлайн-карта, ванильный, сервер, майнкрафт, totemcraft">
<?php include 'lib/module/sys-meta.php';?>
<meta property="og:title" content="TotemCraft - Онлайн-карта" />
<meta property="og:description" content="Онлайн-карта мира TotemCraft: изометрическая карта обычного мира, обновляется раз в сутки." />
<meta property="og:image" content="https://totemcraft.net/img/meta/mobile/1200.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url" content="https://totemcraft.net/map" />
<meta property="og:locale" content="ru_RU"/>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="TotemCraft" />

<?php include 'lib/module/sys-css.php';?>
<?php include 'lib/module/sys-js.php';?>
<style>
/* Карта на весь экран под закреплённой шапкой сайта */
html, body { background: #1a1a1a; overflow: hidden; }
.tc-map-wrap {
	position: fixed;
	top: 72px;
	left: 0;
	right: 0;
	bottom: 0;
	background: #1a1a1a;
}
.tc-map-wrap iframe {
	display: block;
	width: 100%;
	height: 100%;
	border: 0;
}
.menu-btn-backtotop { display: none !important; }
</style>
</head>
<body>
<?php include 'lib/module/sys-php.php';?>
<div class="tc-map-wrap">
	<iframe src="/livemap/" title="Онлайн-карта TotemCraft" allowfullscreen></iframe>
</div>
</body>
</html>
