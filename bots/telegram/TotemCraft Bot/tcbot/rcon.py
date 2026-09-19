"""RCON сервера Minecraft: выполнить команду в консоли без Discord."""
import re
import socket
import struct

from .config import RCON_HOST, RCON_PORT, RCON_PASSWORD


def _recv_exact(sock, size):
    data = b''
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise ConnectionError("RCON: соединение закрыто")
        data += chunk
    return data


def rcon_command(command):
    """Выполняет команду в консоли сервера через RCON и возвращает ответ сервера."""
    if not RCON_PASSWORD:
        raise RuntimeError("RCON_PASSWORD не задан в .env")
    with socket.create_connection((RCON_HOST, RCON_PORT), timeout=5) as sock:
        def send(req_id, ptype, body):
            packet = struct.pack('<ii', req_id, ptype) + body.encode('utf-8') + b'\x00\x00'
            sock.sendall(struct.pack('<i', len(packet)) + packet)
        def recv():
            length = struct.unpack('<i', _recv_exact(sock, 4))[0]
            packet = _recv_exact(sock, length)
            return struct.unpack('<i', packet[:4])[0], packet[8:-2].decode('utf-8', 'replace')
        send(1, 3, RCON_PASSWORD)
        if recv()[0] == -1:
            raise RuntimeError("RCON: неверный пароль")
        send(2, 2, command)
        return re.sub(r'§.', '', recv()[1]).strip()
