#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>

@interface D520Reply : NSObject
@property NSMutableData *bytes;
@end

@implementation D520Reply
- (void)rfcommChannelData:(IOBluetoothRFCOMMChannel *)channel data:(void *)data length:(size_t)length {
    if (self.bytes.length + length <= 4096) [self.bytes appendBytes:data length:length];
}
- (void)sdpQueryComplete:(IOBluetoothDevice *)device status:(IOReturn)status {}
@end

static void tick(void) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.05]];
}

static BluetoothRFCOMMChannelID serialPortChannel(IOBluetoothDevice *device) {
    IOBluetoothSDPUUID *spp = [IOBluetoothSDPUUID uuid16:0x1101];
    BluetoothRFCOMMChannelID selected = 0;
    for (IOBluetoothSDPServiceRecord *record in device.services) {
        IOBluetoothSDPDataElement *classes = [record getAttributeDataElement:1];
        if (!classes) continue;
        // This D520 advertises a lone UUID32. Other SDP records may use a sequence.
        for (IOBluetoothSDPDataElement *element in [classes getArrayValue] ?: @[classes]) {
            if (![[element getUUIDValue] isEqualToUUID:spp]) continue;
            BluetoothRFCOMMChannelID channel = 0;
            if ([record getRFCOMMChannelID:&channel] != kIOReturnSuccess || !channel) continue;
            if (selected && selected != channel) return 0;
            selected = channel;
        }
    }
    return selected;
}

static BOOL sendBytes(IOBluetoothRFCOMMChannel *channel, NSData *payload) {
    UInt16 mtu = channel.getMTU;
    if (!mtu) return NO;
    for (NSUInteger offset = 0; offset < payload.length;) {
        UInt16 count = (UInt16)MIN(payload.length - offset, mtu);
        uint8_t *pointer = (uint8_t *)payload.bytes + offset;
        if ([channel writeSync:pointer length:count] != kIOReturnSuccess) return NO;
        offset += count;
    }
    return YES;
}

static BOOL received(D520Reply *reply, NSData *expected, NSData *rejected) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:4];
    do {
        if (rejected && [reply.bytes rangeOfData:rejected options:0 range:NSMakeRange(0, reply.bytes.length)].location != NSNotFound)
            return NO;
        if ([reply.bytes rangeOfData:expected options:0 range:NSMakeRange(0, reply.bytes.length)].location != NSNotFound)
            return YES;
        tick();
    } while (deadline.timeIntervalSinceNow > 0);
    return NO;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        BOOL probe = argc >= 2 && !strcmp(argv[1], "probe");
        BOOL print = argc == 3 && !strcmp(argv[1], "print");
        if ((!probe && !print) || argc > 3) return 1;
        NSString *address = argc == 3 ? [NSString stringWithUTF8String:argv[2]] : nil;
        IOBluetoothDevice *device = nil;
        for (IOBluetoothDevice *candidate in IOBluetoothDevice.pairedDevices) {
            if (![candidate.name isEqualToString:@"D520"]) continue;
            if (address && ![candidate.addressString isEqualToString:address]) continue;
            if (device) return 2;
            device = candidate;
        }
        if (!device) return 2;
        D520Reply *reply = [D520Reply new];
        reply.bytes = [NSMutableData new];
        BluetoothRFCOMMChannelID port = serialPortChannel(device);
        if (!port && [device performSDPQuery:reply] == kIOReturnSuccess) {
            NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:10];
            do {
                tick();
                port = serialPortChannel(device);
            } while (!port && deadline.timeIntervalSinceNow > 0);
        }
        if (!port) return 3;
        IOBluetoothRFCOMMChannel *channel = nil;
        if ([device openRFCOMMChannelSync:&channel withChannelID:port delegate:reply] != kIOReturnSuccess || !channel)
            return 4;

        BOOL ok = NO;
        if (probe) {
            NSData *query = [@"SSSGETBMAPMODE\r\n" dataUsingEncoding:NSASCIIStringEncoding];
            NSData *mode = [@"SSSGETBMAPMODE:4\r\n" dataUsingEncoding:NSASCIIStringEncoding];
            ok = sendBytes(channel, query) && received(reply, mode, nil);
            if (ok) printf("%s\n", device.addressString.UTF8String);
        } else {
            // Write only the single job supplied by the Bridge. A NAK or missing ACK is uncertain.
            NSData *payload = [[NSFileHandle fileHandleWithStandardInput] readDataOfLength:210000];
            const uint8_t ack[] = {0x7e, 0x01, 0x7e}, nak[] = {0x7e, 0x00, 0x7e};
            ok = payload.length > 0 && payload.length < 210000 && sendBytes(channel, payload)
                && received(reply, [NSData dataWithBytes:ack length:sizeof(ack)],
                            [NSData dataWithBytes:nak length:sizeof(nak)]);
        }
        [channel closeChannel];
        return ok ? 0 : 5;
    }
}
