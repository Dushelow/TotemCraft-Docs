"""Чтение базы GeoLite2-Country (формат MaxMind DB) без сторонних библиотек: IP -> страна.

Формат: https://maxmind.github.io/MaxMind-DB/ . Поддержано то, что нужно для стран:
дерево поиска с записями 24/28/32 бита и типы данных раздела data.
"""
import ipaddress
import os
import struct

_META_MARKER = b"\xab\xcd\xefMaxMind.com"


class Reader:
    def __init__(self, path):
        with open(path, 'rb') as f:
            self.buf = f.read()
        pos = self.buf.rfind(_META_MARKER)
        if pos < 0:
            raise ValueError("это не файл MaxMind DB")
        meta_start = pos + len(_META_MARKER)
        self.meta, _ = self._decode(meta_start, base=meta_start)
        self.node_count = self.meta['node_count']
        self.record_size = self.meta['record_size']
        self.ip_version = self.meta['ip_version']
        self.node_bytes = self.record_size * 2 // 8
        self.tree_size = self.node_bytes * self.node_count
        self.data_start = self.tree_size + 16
        self._ipv4_start = None

    # --- дерево поиска ---
    def _read_node(self, node, index):
        off = node * self.node_bytes
        b = self.buf
        if self.record_size == 24:
            o = off + index * 3
            return int.from_bytes(b[o:o + 3], 'big')
        if self.record_size == 28:
            middle = b[off + 3]
            if index == 0:
                return ((middle & 0xF0) << 20) | int.from_bytes(b[off:off + 3], 'big')
            return ((middle & 0x0F) << 24) | int.from_bytes(b[off + 4:off + 7], 'big')
        if self.record_size == 32:
            o = off + index * 4
            return int.from_bytes(b[o:o + 4], 'big')
        raise ValueError(f"размер записи {self.record_size} не поддержан")

    def _start_node(self, bits):
        if self.ip_version == 6 and bits == 32:
            if self._ipv4_start is None:
                node = 0
                for _ in range(96):
                    if node >= self.node_count:
                        break
                    node = self._read_node(node, 0)
                self._ipv4_start = node
            return self._ipv4_start
        return 0

    def get(self, ip):
        """Запись базы для IP или None."""
        addr = ipaddress.ip_address(ip)
        packed = addr.packed
        bits = len(packed) * 8
        node = self._start_node(bits)
        for i in range(bits):
            if node >= self.node_count:
                break
            bit = (packed[i >> 3] >> (7 - (i & 7))) & 1
            node = self._read_node(node, bit)
        if node == self.node_count:
            return None
        if node > self.node_count:
            offset = node - self.node_count - 16
            value, _ = self._decode(self.data_start + offset, base=self.data_start)
            return value
        raise ValueError("битое дерево поиска")

    # --- раздел данных ---
    def _decode(self, pos, base):
        b = self.buf
        ctrl = b[pos]
        pos += 1
        typ = ctrl >> 5
        if typ == 1:  # указатель
            size = (ctrl >> 3) & 0x3
            v = ctrl & 0x7
            if size == 0:
                ptr = (v << 8) | b[pos]; pos += 1
            elif size == 1:
                ptr = ((v << 16) | int.from_bytes(b[pos:pos + 2], 'big')) + 2048; pos += 2
            elif size == 2:
                ptr = ((v << 24) | int.from_bytes(b[pos:pos + 3], 'big')) + 526336; pos += 3
            else:
                ptr = int.from_bytes(b[pos:pos + 4], 'big'); pos += 4
            value, _ = self._decode(base + ptr, base)
            return value, pos
        if typ == 0:  # расширенный тип
            typ = 7 + b[pos]
            pos += 1
        size = ctrl & 0x1F
        if size == 29:
            size = 29 + b[pos]; pos += 1
        elif size == 30:
            size = 285 + int.from_bytes(b[pos:pos + 2], 'big'); pos += 2
        elif size == 31:
            size = 65821 + int.from_bytes(b[pos:pos + 3], 'big'); pos += 3

        if typ == 2:  # строка
            return b[pos:pos + size].decode('utf-8'), pos + size
        if typ == 3:  # double
            return struct.unpack('>d', b[pos:pos + 8])[0], pos + 8
        if typ == 4:  # байты
            return b[pos:pos + size], pos + size
        if typ in (5, 6, 9, 10):  # беззнаковые целые
            return int.from_bytes(b[pos:pos + size], 'big') if size else 0, pos + size
        if typ == 7:  # словарь
            out = {}
            for _ in range(size):
                k, pos = self._decode(pos, base)
                v, pos = self._decode(pos, base)
                out[k] = v
            return out, pos
        if typ == 8:  # int32
            raw = b[pos:pos + size].rjust(4, b'\x00')
            return struct.unpack('>i', raw)[0], pos + size
        if typ == 11:  # массив
            out = []
            for _ in range(size):
                v, pos = self._decode(pos, base)
                out.append(v)
            return out, pos
        if typ == 14:  # bool
            return bool(size), pos
        if typ == 15:  # float
            return struct.unpack('>f', b[pos:pos + 4])[0], pos + 4
        raise ValueError(f"тип данных {typ} не поддержан")


_readers = {}


def country(path, ip):
    """(код страны, название по-русски или по-английски) или None. Файл читается один раз."""
    if not path or not os.path.exists(path) or not ip:
        return None
    mtime = os.path.getmtime(path)
    cached = _readers.get(path)
    if not cached or cached[0] != mtime:
        _readers[path] = (mtime, Reader(path))
    rec = _readers[path][1].get(ip)
    if not rec:
        return None
    c = rec.get('country') or rec.get('registered_country') or {}
    names = c.get('names', {})
    iso = c.get('iso_code')
    return iso, _NAMES.get(iso) or names.get('ru') or names.get('en') or iso


_NAMES = {'DE': 'Германия', 'US': 'США', 'GB': 'Великобритания'}  # в базе по-русски «ФРГ» и т.п.
